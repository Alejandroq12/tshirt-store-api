import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentMethod, Prisma, UserRole } from '@prisma/client';
import type Stripe from 'stripe';

import type { EnvironmentVariables } from '../config/env.validation';
import { StockCycleService } from '../notifications/stock-cycle.service';
import { StockNotificationProducer } from '../notifications/stock-notification.producer';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from './stripe.client';

const PAYMENT_LINK_SELECT = {
  id: true,
  skuId: true,
  quantity: true,
  sku: { select: { productId: true } },
} satisfies Prisma.PaymentLinkSelect;

const ORDER_FOR_PAYMENT_SELECT = {
  id: true,
  clientId: true,
  status: true,
  paymentMethod: true,
  stripePaymentIntentId: true,
  items: {
    orderBy: { skuId: 'asc' },
    select: { skuId: true, productId: true, quantity: true },
  },
} satisfies Prisma.OrderSelect;

const INVENTORY_SELECT = {
  id: true,
  productId: true,
  skuCode: true,
  size: true,
  color: true,
  price: true,
  stockQuantity: true,
  product: {
    select: { name: true, isActive: true, deletedAt: true },
  },
} satisfies Prisma.ProductSkuSelect;

type InventorySku = Prisma.ProductSkuGetPayload<{
  select: typeof INVENTORY_SELECT;
}>;

interface StockLine {
  skuId: string;
  productId: string;
  quantity: number;
}

interface LockedCartItem {
  id: string;
  skuId: string;
  quantity: number;
}

interface ProcessedPayment {
  orderId: string;
  notificationIds: string[];
}

interface StockMutation {
  inventory: Map<string, InventorySku>;
  transitions: StockTransition[];
}

interface StockTransition {
  productId: string;
  totalBefore: number;
  totalAfter: number;
}

type SupportedStripeEvent =
  Stripe.CheckoutSessionCompletedEvent | Stripe.PaymentIntentSucceededEvent;

const isSupportedEvent = (event: Stripe.Event): event is SupportedStripeEvent =>
  event.type === 'checkout.session.completed' ||
  event.type === 'payment_intent.succeeded';

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const referencedId = (value: { id: string } | string | null): string | null =>
  typeof value === 'string' ? value : (value?.id ?? null);

const processingError = (message: string): Error => new Error(message);

@Injectable()
export class StripeWebhookService {
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly stockCycle: StockCycleService,
    private readonly notifications: StockNotificationProducer,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.webhookSecret = config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  async receive(rawBody?: Buffer, signature?: string): Promise<void> {
    if (!rawBody || rawBody.length === 0 || !signature) {
      throw new BadRequestException();
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw new BadRequestException();
    }

    if (!isSupportedEvent(event)) throw new BadRequestException();

    const existing = await this.prisma.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
      select: { id: true },
    });
    if (existing) return;

    let stored;
    try {
      stored = await this.prisma.stripeWebhookEvent.create({
        data: {
          stripeEventId: event.id,
          eventType: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return;
      throw error;
    }

    try {
      await this.process(stored.id);
    } catch {
      return;
    }
  }

  async process(storedEventId: string): Promise<void> {
    let notificationIds: string[];

    try {
      notificationIds = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT id FROM stripe_webhook_events WHERE id = ${storedEventId}::uuid FOR UPDATE`,
        );

        const stored = await transaction.stripeWebhookEvent.findUnique({
          where: { id: storedEventId },
        });
        if (!stored || stored.processedAt) return [];

        const event = stored.payload as unknown as SupportedStripeEvent;
        const processed =
          event.type === 'payment_intent.succeeded'
            ? await this.processPaymentIntent(transaction, event)
            : await this.processCheckoutSession(transaction, event);

        await transaction.stripeWebhookEvent.update({
          where: { id: stored.id },
          data: {
            orderId: processed.orderId,
            processedAt: new Date(),
            errorMessage: null,
          },
        });

        return processed.notificationIds;
      });
    } catch (error) {
      await this.prisma.stripeWebhookEvent
        .updateMany({
          where: { id: storedEventId, processedAt: null },
          data: {
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => undefined);
      throw error;
    }

    await this.notifications.enqueue(notificationIds);
  }

  private async processPaymentIntent(
    transaction: Prisma.TransactionClient,
    event: Stripe.PaymentIntentSucceededEvent,
  ): Promise<ProcessedPayment> {
    const intent = event.data.object;
    const orderId = intent.metadata.orderId;

    if (intent.status !== 'succeeded' || !orderId) {
      throw processingError('Payment Intent event is missing payment data');
    }

    const order = await transaction.order.findUnique({
      where: { id: orderId },
      select: ORDER_FOR_PAYMENT_SELECT,
    });
    if (!order || order.paymentMethod !== PaymentMethod.PAYMENT_INTENT) {
      throw processingError('Payment Intent order was not found');
    }

    if (
      order.status === OrderStatus.PAID &&
      order.stripePaymentIntentId === intent.id
    ) {
      return { orderId: order.id, notificationIds: [] };
    }
    if (
      order.status !== OrderStatus.PENDING ||
      order.stripePaymentIntentId !== intent.id
    ) {
      throw processingError('Payment Intent order cannot be paid');
    }

    const stock = await this.decrementStock(transaction, order.items);

    const updated = await transaction.order.updateMany({
      where: {
        id: order.id,
        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.PAYMENT_INTENT,
        stripePaymentIntentId: intent.id,
      },
      data: {
        status: OrderStatus.PAID,
        stripePaymentIntentId: intent.id,
        paidAt: new Date(event.created * 1000),
      },
    });
    if (updated.count !== 1) {
      throw processingError('Payment Intent order changed concurrently');
    }

    await this.reconcileCart(transaction, order.clientId, order.items);
    return {
      orderId: order.id,
      notificationIds: await this.evaluateStock(transaction, stock.transitions),
    };
  }

  private async processCheckoutSession(
    transaction: Prisma.TransactionClient,
    event: Stripe.CheckoutSessionCompletedEvent,
  ): Promise<ProcessedPayment> {
    const session = event.data.object;
    const stripePaymentLinkId = referencedId(session.payment_link);
    const email = session.customer_details?.email ?? session.customer_email;
    const chargedCents = session.amount_total;

    if (
      session.payment_status !== 'paid' ||
      !stripePaymentLinkId ||
      !email ||
      chargedCents === null ||
      chargedCents <= 0
    ) {
      throw processingError('Checkout Session is missing payment data');
    }

    const existing = await transaction.order.findUnique({
      where: { stripeCheckoutSessionId: session.id },
      select: { id: true },
    });
    if (existing) return { orderId: existing.id, notificationIds: [] };

    const [link, client] = await Promise.all([
      transaction.paymentLink.findUnique({
        where: { stripePaymentLinkId },
        select: PAYMENT_LINK_SELECT,
      }),
      transaction.user.findFirst({
        where: { email: email.toLowerCase(), role: UserRole.CLIENT },
        select: { id: true },
      }),
    ]);
    if (!link || !client) {
      throw processingError('Checkout Session cannot be matched locally');
    }

    const stock = await this.decrementStock(transaction, [
      {
        skuId: link.skuId,
        productId: link.sku.productId,
        quantity: link.quantity,
      },
    ]);
    const sku = stock.inventory.get(link.skuId);
    if (!sku) throw processingError('Payment Link SKU was not found');

    if (chargedCents % link.quantity !== 0) {
      throw processingError('Checkout Session total is not a whole unit price');
    }

    const totalAmount = new Prisma.Decimal(chargedCents).div(100);
    const unitPrice = new Prisma.Decimal(chargedCents / link.quantity).div(100);

    const order = await transaction.order.create({
      data: {
        clientId: client.id,
        status: OrderStatus.PAID,
        paymentMethod: PaymentMethod.PAYMENT_LINK,
        totalAmount,
        paymentLinkId: link.id,
        stripeCheckoutSessionId: session.id,
        paidAt: new Date(event.created * 1000),
        items: {
          create: {
            skuId: sku.id,
            productId: sku.productId,
            productName: sku.product.name,
            skuCode: sku.skuCode,
            size: sku.size,
            color: sku.color,
            unitPrice,
            quantity: link.quantity,
            lineTotal: totalAmount,
          },
        },
      },
      select: { id: true },
    });

    return {
      orderId: order.id,
      notificationIds: await this.evaluateStock(transaction, stock.transitions),
    };
  }

  private async decrementStock(
    transaction: Prisma.TransactionClient,
    lines: StockLine[],
  ): Promise<StockMutation> {
    if (lines.length === 0) {
      throw processingError('Payment has no order lines');
    }

    await this.lockInventory(transaction, lines);

    const productIds = [
      ...new Set(lines.map(({ productId }) => productId)),
    ].sort();
    const totalsBefore = new Map<string, number>();
    for (const productId of productIds) {
      totalsBefore.set(
        productId,
        await this.stockCycle.totalStock(transaction, productId),
      );
    }

    const skuIds = lines.map(({ skuId }) => skuId);
    const inventory = await transaction.productSku.findMany({
      where: { id: { in: skuIds } },
      select: INVENTORY_SELECT,
    });
    const bySku = new Map(inventory.map((sku) => [sku.id, sku]));

    for (const line of lines) {
      const sku = bySku.get(line.skuId);
      if (!sku || sku.productId !== line.productId) {
        throw processingError('Payment SKU was not found');
      }
      if (!sku.product.isActive || sku.product.deletedAt !== null) {
        throw processingError('Payment product is not active');
      }
      if (sku.stockQuantity < line.quantity) {
        throw processingError(`Insufficient stock for SKU ${line.skuId}`);
      }
    }

    for (const line of [...lines].sort((left, right) =>
      left.skuId.localeCompare(right.skuId),
    )) {
      await transaction.productSku.update({
        where: { id: line.skuId },
        data: { stockQuantity: { decrement: line.quantity } },
        select: { id: true },
      });
    }

    const transitions: StockTransition[] = [];
    for (const productId of productIds) {
      const totalAfter = await this.stockCycle.totalStock(
        transaction,
        productId,
      );
      transitions.push({
        productId,
        totalBefore: totalsBefore.get(productId)!,
        totalAfter,
      });
    }

    return { inventory: bySku, transitions };
  }

  private async evaluateStock(
    transaction: Prisma.TransactionClient,
    transitions: StockTransition[],
  ): Promise<string[]> {
    const notificationIds: string[] = [];

    for (const { productId, totalBefore, totalAfter } of transitions) {
      notificationIds.push(
        ...(await this.stockCycle.evaluate(
          transaction,
          productId,
          totalBefore,
          totalAfter,
        )),
      );
    }

    return notificationIds;
  }

  private async lockInventory(
    transaction: Prisma.TransactionClient,
    lines: StockLine[],
  ): Promise<void> {
    const productIds = [
      ...new Set(lines.map(({ productId }) => productId)),
    ].sort();
    const skuIds = [...new Set(lines.map(({ skuId }) => skuId))].sort();
    const products = Prisma.join(
      productIds.map((id) => Prisma.sql`${id}::uuid`),
    );
    const skus = Prisma.join(skuIds.map((id) => Prisma.sql`${id}::uuid`));

    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM products WHERE id IN (${products}) ORDER BY id FOR UPDATE`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM product_skus WHERE id IN (${skus}) ORDER BY id FOR UPDATE`,
    );
  }

  private async reconcileCart(
    transaction: Prisma.TransactionClient,
    clientId: string,
    lines: StockLine[],
  ): Promise<void> {
    const skuIds = [...new Set(lines.map(({ skuId }) => skuId))].sort();
    const ids = Prisma.join(skuIds.map((id) => Prisma.sql`${id}::uuid`));
    const cartItems = await transaction.$queryRaw<LockedCartItem[]>(
      Prisma.sql`
        SELECT ci.id, ci.sku_id AS "skuId", ci.quantity
        FROM cart_items ci
        JOIN carts c ON c.id = ci.cart_id
        WHERE c.client_id = ${clientId}::uuid
          AND ci.sku_id IN (${ids})
        ORDER BY ci.sku_id
        FOR UPDATE OF ci
      `,
    );
    const bySku = new Map(cartItems.map((item) => [item.skuId, item]));

    for (const line of [...lines].sort((left, right) =>
      left.skuId.localeCompare(right.skuId),
    )) {
      const item = bySku.get(line.skuId);
      if (!item) continue;

      const quantity = item.quantity - line.quantity;
      if (quantity > 0) {
        await transaction.cartItem.update({
          where: { id: item.id },
          data: { quantity },
          select: { id: true },
        });
      } else {
        await transaction.cartItem.deleteMany({ where: { id: item.id } });
      }
    }
  }
}
