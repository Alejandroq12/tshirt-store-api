import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentMethod, Prisma, UserRole } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  PROBLEM_TYPE,
  type ProblemDetail,
  ProblemException,
} from '../common/problems';
import type { EnvironmentVariables } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentIntentCreateRequest,
  PaymentLinkCreateRequest,
} from './payments.dto';
import { StripeClient } from './stripe.client';

const SKU_FOR_LINK_SELECT = {
  id: true,
  skuCode: true,
  size: true,
  color: true,
  price: true,
  product: {
    select: { id: true, name: true, isActive: true, deletedAt: true },
  },
} satisfies Prisma.ProductSkuSelect;

const ORDER_FOR_INTENT_SELECT = {
  id: true,
  status: true,
  paymentMethod: true,
  totalAmount: true,
  stripePaymentIntentId: true,
  items: {
    orderBy: { id: 'asc' },
    select: {
      skuId: true,
      quantity: true,
      sku: {
        select: {
          stockQuantity: true,
          product: { select: { isActive: true, deletedAt: true } },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

export interface PaymentLinkResponse {
  id: string;
  skuId: string;
  quantity: number;
  url: string;
  createdAt: string;
}

export interface PaymentIntentResponse {
  id: string;
  orderId: string;
  clientSecret: string;
  amount: string;
  currency: string;
}

export interface InsufficientStockItem {
  skuId: string;
  requestedQuantity: number;
  availableQuantity: number;
}

interface PaymentIntentConflictDetail extends ProblemDetail {
  items: InsufficientStockItem[];
}

const stockConflict = (items: InsufficientStockItem[]): ProblemException => {
  const problem: PaymentIntentConflictDetail = {
    type: PROBLEM_TYPE.BLANK,
    title: 'Conflict',
    status: 409,
    items,
  };

  return new ProblemException(problem);
};

@Injectable()
export class PaymentsService {
  private readonly currency: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.currency = config.get('STORE_CURRENCY', { infer: true });
  }

  async createLink(
    input: PaymentLinkCreateRequest,
    user: AuthenticatedUser,
  ): Promise<PaymentLinkResponse> {
    const sku = await this.prisma.productSku.findUnique({
      where: { id: input.skuId },
      select: SKU_FOR_LINK_SELECT,
    });

    if (!sku) throw new NotFoundException();
    if (!sku.product.isActive || sku.product.deletedAt !== null) {
      throw new ConflictException();
    }

    let stripeLink;
    try {
      stripeLink = await this.stripe.createPaymentLink({
        line_items: [
          {
            price_data: {
              currency: this.currency.toLowerCase(),
              product_data: { name: sku.product.name },
              unit_amount: sku.price.mul(100).toNumber(),
            },
            quantity: input.quantity,
          },
        ],
        metadata: {
          skuId: sku.id,
          quantity: String(input.quantity),
        },
      });
    } catch {
      throw new BadGatewayException();
    }

    const link = await this.prisma.paymentLink.create({
      data: {
        skuId: sku.id,
        quantity: input.quantity,
        stripePaymentLinkId: stripeLink.id,
        url: stripeLink.url,
        createdBy: user.id,
      },
    });

    return {
      id: link.id,
      skuId: link.skuId,
      quantity: link.quantity,
      url: link.url,
      createdAt: link.createdAt.toISOString(),
    };
  }

  async createIntent(
    input: PaymentIntentCreateRequest,
    user: AuthenticatedUser,
  ): Promise<PaymentIntentResponse> {
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();

    const order = await this.prisma.order.findFirst({
      where: { id: input.orderId, clientId: user.id },
      select: ORDER_FOR_INTENT_SELECT,
    });

    if (!order) throw new NotFoundException();
    if (
      order.status !== OrderStatus.PENDING ||
      order.paymentMethod !== PaymentMethod.PAYMENT_INTENT ||
      order.stripePaymentIntentId !== null
    ) {
      throw new ConflictException();
    }
    if (
      order.items.some(
        ({ sku }) => !sku.product.isActive || sku.product.deletedAt !== null,
      )
    ) {
      throw new ConflictException();
    }

    const insufficient = order.items
      .filter(({ quantity, sku }) => sku.stockQuantity < quantity)
      .map(({ skuId, quantity, sku }) => ({
        skuId,
        requestedQuantity: quantity,
        availableQuantity: sku.stockQuantity,
      }))
      .sort((left, right) => left.skuId.localeCompare(right.skuId));

    if (insufficient.length > 0) throw stockConflict(insufficient);

    let intent;
    try {
      intent = await this.stripe.createPaymentIntent(
        {
          amount: order.totalAmount.mul(100).toNumber(),
          currency: this.currency.toLowerCase(),
          metadata: { orderId: order.id },
        },
        { idempotencyKey: order.id },
      );
    } catch {
      throw new BadGatewayException();
    }

    if (!intent.client_secret) throw new BadGatewayException();

    const claimed = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        clientId: user.id,
        status: OrderStatus.PENDING,
        stripePaymentIntentId: null,
      },
      data: { stripePaymentIntentId: intent.id },
    });

    if (claimed.count !== 1) throw new ConflictException();

    return {
      id: intent.id,
      orderId: order.id,
      clientSecret: intent.client_secret,
      amount: order.totalAmount.toFixed(2),
      currency: this.currency,
    };
  }
}
