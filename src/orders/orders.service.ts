import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus as PrismaOrderStatus,
  PaymentMethod as PrismaPaymentMethod,
  Prisma,
  UserRole,
} from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  PROBLEM_TYPE,
  ProblemException,
  ValidationProblemException,
} from '../common/problems';
import type { EnvironmentVariables } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListMyOrdersQuery,
  ListOrdersQuery,
  OrderStatusFilter,
  OrderStatusUpdate,
  OrderStatusUpdateRequest,
} from './orders.dto';

const ORDER_INCLUDE = {
  items: { orderBy: { id: 'asc' } },
} satisfies Prisma.OrderInclude;

const CART_SNAPSHOT_SELECT = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      quantity: true,
      sku: {
        select: {
          id: true,
          productId: true,
          skuCode: true,
          size: true,
          color: true,
          price: true,
          product: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.CartSelect;

type OrderRecord = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type OrderItemRecord = OrderRecord['items'][number];

const RESPONSE_STATUS = {
  [PrismaOrderStatus.PENDING]: 'pending',
  [PrismaOrderStatus.PAID]: 'paid',
  [PrismaOrderStatus.PROCESSING]: 'processing',
  [PrismaOrderStatus.SHIPPED]: 'shipped',
  [PrismaOrderStatus.CANCELLED]: 'cancelled',
} as const satisfies Record<PrismaOrderStatus, string>;

const PRISMA_STATUS = {
  [OrderStatusFilter.PENDING]: PrismaOrderStatus.PENDING,
  [OrderStatusFilter.PAID]: PrismaOrderStatus.PAID,
  [OrderStatusFilter.PROCESSING]: PrismaOrderStatus.PROCESSING,
  [OrderStatusFilter.SHIPPED]: PrismaOrderStatus.SHIPPED,
  [OrderStatusFilter.CANCELLED]: PrismaOrderStatus.CANCELLED,
} as const satisfies Record<OrderStatusFilter, PrismaOrderStatus>;

const RESPONSE_PAYMENT_METHOD = {
  [PrismaPaymentMethod.PAYMENT_LINK]: 'payment_link',
  [PrismaPaymentMethod.PAYMENT_INTENT]: 'payment_intent',
} as const satisfies Record<PrismaPaymentMethod, string>;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const emptyCartProblem = (): ProblemException =>
  new ProblemException({
    type: PROBLEM_TYPE.EMPTY_CART,
    title: 'Cart is empty',
    status: HttpStatus.CONFLICT,
  });

const pendingOrderProblem = (): ProblemException =>
  new ProblemException({
    type: PROBLEM_TYPE.PENDING_ORDER_EXISTS,
    title: 'Pending order already exists',
    status: HttpStatus.CONFLICT,
  });

export interface OrderItemResponse {
  id: string;
  productId: string;
  skuId: string;
  productName: string;
  skuCode: string;
  size: string;
  color: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrderResponse {
  id: string;
  clientId: string;
  status: (typeof RESPONSE_STATUS)[PrismaOrderStatus];
  paymentMethod: (typeof RESPONSE_PAYMENT_METHOD)[PrismaPaymentMethod];
  items: OrderItemResponse[];
  totalAmount: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
}

export interface OrderPageResponse {
  items: OrderResponse[];
  pagination: { limit: number; offset: number; total: number };
}

@Injectable()
export class OrdersService {
  private readonly currency: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.currency = config.get('STORE_CURRENCY', { infer: true });
  }

  async createFromCart(user: AuthenticatedUser): Promise<OrderResponse> {
    const order = await this.prisma.$transaction(async (transaction) => {
      const cart = await transaction.cart.findUnique({
        where: { clientId: user.id },
        select: CART_SNAPSHOT_SELECT,
      });

      if (!cart || cart.items.length === 0) throw emptyCartProblem();

      const pending = await transaction.order.findFirst({
        where: { clientId: user.id, status: PrismaOrderStatus.PENDING },
        select: { id: true },
      });

      if (pending) throw pendingOrderProblem();

      const items = cart.items
        .map((item) => {
          const lineTotal = item.sku.price.mul(item.quantity);

          return {
            skuId: item.sku.id,
            productId: item.sku.productId,
            productName: item.sku.product.name,
            skuCode: item.sku.skuCode,
            size: item.sku.size,
            color: item.sku.color,
            unitPrice: item.sku.price,
            quantity: item.quantity,
            lineTotal,
          };
        })
        .sort((left, right) => left.skuId.localeCompare(right.skuId));
      const totalAmount = items.reduce(
        (total, item) => total.add(item.lineTotal),
        new Prisma.Decimal('0.00'),
      );

      try {
        return await transaction.order.create({
          data: {
            clientId: user.id,
            status: PrismaOrderStatus.PENDING,
            paymentMethod: PrismaPaymentMethod.PAYMENT_INTENT,
            totalAmount,
            items: { create: items },
          },
          include: ORDER_INCLUDE,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw pendingOrderProblem();
        throw error;
      }
    });

    return this.orderResponse(order);
  }

  async get(orderId: string, user: AuthenticatedUser): Promise<OrderResponse> {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        ...(user.role === UserRole.MANAGER ? {} : { clientId: user.id }),
      },
      include: ORDER_INCLUDE,
    });

    if (!order) throw new NotFoundException();
    return this.orderResponse(order);
  }

  async list(query: ListOrdersQuery): Promise<OrderPageResponse> {
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
        include: ORDER_INCLUDE,
      }),
      this.prisma.order.count(),
    ]);

    return {
      items: orders.map((order) => this.orderResponse(order)),
      pagination: { limit: query.limit, offset: query.offset, total },
    };
  }

  async listMine(
    query: ListMyOrdersQuery,
    user: AuthenticatedUser,
  ): Promise<OrderPageResponse> {
    if (user.role !== UserRole.CLIENT) throw new ForbiddenException();

    const from = query.from === undefined ? undefined : new Date(query.from);
    const to = query.to === undefined ? undefined : new Date(query.to);

    if (from && to && from > to) {
      throw new ValidationProblemException([
        { field: 'to', message: 'Must not be earlier than from.' },
      ]);
    }
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      new Prisma.Decimal(query.minPrice).greaterThan(query.maxPrice)
    ) {
      throw new ValidationProblemException([
        { field: 'maxPrice', message: 'Must not be less than minPrice.' },
      ]);
    }

    const where: Prisma.OrderWhereInput = {
      clientId: user.id,
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(query.status === undefined
        ? {}
        : { status: PRISMA_STATUS[query.status] }),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            totalAmount: {
              ...(query.minPrice === undefined ? {} : { gte: query.minPrice }),
              ...(query.maxPrice === undefined ? {} : { lte: query.maxPrice }),
            },
          }
        : {}),
    };

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
        include: ORDER_INCLUDE,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: orders.map((order) => this.orderResponse(order)),
      pagination: { limit: query.limit, offset: query.offset, total },
    };
  }

  async updateStatus(
    orderId: string,
    input: OrderStatusUpdateRequest,
    user: AuthenticatedUser,
  ): Promise<OrderResponse> {
    this.requireRoleFor(input.status, user.role);

    const order = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.order.findFirst({
        where: {
          id: orderId,
          ...(user.role === UserRole.MANAGER ? {} : { clientId: user.id }),
        },
        include: ORDER_INCLUDE,
      });

      if (!current) throw new NotFoundException();

      if (input.status === OrderStatusUpdate.PROCESSING) {
        if (current.status !== PrismaOrderStatus.PAID) {
          throw new ConflictException();
        }
        await this.changeStatus(
          transaction,
          orderId,
          PrismaOrderStatus.PAID,
          PrismaOrderStatus.PROCESSING,
        );
      } else if (input.status === OrderStatusUpdate.SHIPPED) {
        if (current.status !== PrismaOrderStatus.PROCESSING) {
          throw new ConflictException();
        }
        await this.changeStatus(
          transaction,
          orderId,
          PrismaOrderStatus.PROCESSING,
          PrismaOrderStatus.SHIPPED,
        );
      } else {
        await this.cancel(transaction, current);
      }

      return transaction.order.findUniqueOrThrow({
        where: { id: orderId },
        include: ORDER_INCLUDE,
      });
    });

    return this.orderResponse(order);
  }

  private requireRoleFor(status: OrderStatusUpdate, role: UserRole): void {
    const allowed =
      status === OrderStatusUpdate.CANCELLED
        ? role === UserRole.CLIENT
        : role === UserRole.MANAGER;

    if (!allowed) throw new ForbiddenException();
  }

  private async cancel(
    transaction: Prisma.TransactionClient,
    order: OrderRecord,
  ): Promise<void> {
    if (order.status === PrismaOrderStatus.PENDING) {
      await this.changeStatus(
        transaction,
        order.id,
        PrismaOrderStatus.PENDING,
        PrismaOrderStatus.CANCELLED,
        new Date(),
      );
      return;
    }

    if (
      order.status !== PrismaOrderStatus.PAID &&
      order.status !== PrismaOrderStatus.PROCESSING
    ) {
      throw new ConflictException();
    }

    await this.lockStockRows(transaction, order.items);
    await this.changeStatus(
      transaction,
      order.id,
      order.status,
      PrismaOrderStatus.CANCELLED,
      new Date(),
    );

    for (const item of [...order.items].sort((left, right) =>
      left.skuId.localeCompare(right.skuId),
    )) {
      await transaction.productSku.update({
        where: { id: item.skuId },
        data: { stockQuantity: { increment: item.quantity } },
        select: { id: true },
      });
    }
  }

  private async changeStatus(
    transaction: Prisma.TransactionClient,
    orderId: string,
    from: PrismaOrderStatus,
    to: PrismaOrderStatus,
    cancelledAt?: Date,
  ): Promise<void> {
    const result = await transaction.order.updateMany({
      where: { id: orderId, status: from },
      data: { status: to, ...(cancelledAt ? { cancelledAt } : {}) },
    });

    if (result.count !== 1) throw new ConflictException();
  }

  private async lockStockRows(
    transaction: Prisma.TransactionClient,
    items: OrderItemRecord[],
  ): Promise<void> {
    const productIds = [
      ...new Set(items.map(({ productId }) => productId)),
    ].sort();
    const skuIds = [...new Set(items.map(({ skuId }) => skuId))].sort();

    if (productIds.length > 0) {
      const ids = Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`));
      await transaction.$queryRaw(
        Prisma.sql`SELECT id FROM products WHERE id IN (${ids}) ORDER BY id FOR UPDATE`,
      );
    }
    if (skuIds.length > 0) {
      const ids = Prisma.join(skuIds.map((id) => Prisma.sql`${id}::uuid`));
      await transaction.$queryRaw(
        Prisma.sql`SELECT id FROM product_skus WHERE id IN (${ids}) ORDER BY id FOR UPDATE`,
      );
    }
  }

  private orderResponse(order: OrderRecord): OrderResponse {
    return {
      id: order.id,
      clientId: order.clientId,
      status: RESPONSE_STATUS[order.status],
      paymentMethod: RESPONSE_PAYMENT_METHOD[order.paymentMethod],
      items: order.items.map((item) => this.orderItemResponse(item)),
      totalAmount: order.totalAmount.toFixed(2),
      currency: this.currency,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
    };
  }

  private orderItemResponse(item: OrderItemRecord): OrderItemResponse {
    return {
      id: item.id,
      productId: item.productId,
      skuId: item.skuId,
      productName: item.productName,
      skuCode: item.skuCode,
      size: item.size,
      color: item.color,
      unitPrice: item.unitPrice.toFixed(2),
      quantity: item.quantity,
      lineTotal: item.lineTotal.toFixed(2),
    };
  }
}
