import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  type Product,
  type ProductSku,
  type User,
} from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { OrderResponse } from '../src/orders/types/orders.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './support/create-test-app';
import { truncateAll } from './support/database';
import {
  createClient,
  createManager,
  createProductWithSku,
  KNOWN_PASSWORD,
} from './support/fixtures';

interface AuthSessionBody {
  accessToken: string;
}

interface OrderFixtureOptions {
  clientId: string;
  product: Product;
  sku: ProductSku;
  status: OrderStatus;
  totalAmount: string;
  createdAt: Date;
}

const PROBLEM_JSON = /^application\/problem\+json/;

describe('Orders (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = (await createTestApp()) as INestApplication<App>;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  const login = async (user: User): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: user.email, password: KNOWN_PASSWORD })
      .expect(200);

    return (response.body as AuthSessionBody).accessToken;
  };

  // Writes the row directly so a test can start from paid, processing or
  // shipped, which only the webhook or an earlier manager step can reach;
  // paidAt, cancelledAt and the intent id follow chk_orders_paid_at,
  // chk_orders_cancelled_at and chk_orders_stripe_id.
  const createOrder = ({
    clientId,
    product,
    sku,
    status,
    totalAmount,
    createdAt,
  }: OrderFixtureOptions) => {
    const isPaid =
      status === OrderStatus.PAID ||
      status === OrderStatus.PROCESSING ||
      status === OrderStatus.SHIPPED;

    return prisma.order.create({
      data: {
        clientId,
        status,
        paymentMethod: PaymentMethod.PAYMENT_INTENT,
        totalAmount,
        paidAt: isPaid ? createdAt : null,
        cancelledAt: status === OrderStatus.CANCELLED ? createdAt : null,
        stripePaymentIntentId: isPaid ? `pi_${randomUUID()}` : null,
        createdAt,
        updatedAt: createdAt,
        items: {
          create: {
            productId: product.id,
            skuId: sku.id,
            productName: product.name,
            skuCode: sku.skuCode,
            size: sku.size,
            color: sku.color,
            unitPrice: totalAmount,
            quantity: 1,
            lineTotal: totalAmount,
          },
        },
      },
    });
  };

  const changeStatus = (token: string, orderId: string, status: string) =>
    request(app.getHttpServer())
      .patch(`/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status });

  it('lets a manager move a paid order to processing and then shipped, keeping paidAt', async () => {
    const client = await createClient(prisma);
    const manager = await createManager(prisma);
    const managerToken = await login(manager);
    const { product, sku } = await createProductWithSku(prisma);
    const createdAt = new Date('2026-09-01T10:00:00.000Z');
    const order = await createOrder({
      clientId: client.id,
      product,
      sku,
      status: OrderStatus.PAID,
      totalAmount: '19.99',
      createdAt,
    });

    const processing = await changeStatus(
      managerToken,
      order.id,
      'processing',
    ).expect(200);
    expect(processing.body).toMatchObject({
      id: order.id,
      clientId: client.id,
      status: 'processing',
      paidAt: createdAt.toISOString(),
      cancelledAt: null,
    });

    const shipped = await changeStatus(
      managerToken,
      order.id,
      'shipped',
    ).expect(200);
    expect(shipped.body).toMatchObject({
      id: order.id,
      status: 'shipped',
      paidAt: createdAt.toISOString(),
      cancelledAt: null,
    });

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({
      status: OrderStatus.SHIPPED,
      paidAt: createdAt,
      cancelledAt: null,
    });
  });

  it('refuses a skipped step, a finished order and paid as a target', async () => {
    const client = await createClient(prisma);
    const manager = await createManager(prisma);
    const managerToken = await login(manager);
    const { product, sku } = await createProductWithSku(prisma);
    const paid = await createOrder({
      clientId: client.id,
      product,
      sku,
      status: OrderStatus.PAID,
      totalAmount: '19.99',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    const shipped = await createOrder({
      clientId: client.id,
      product,
      sku,
      status: OrderStatus.SHIPPED,
      totalAmount: '25.00',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    });

    const skipped = await changeStatus(managerToken, paid.id, 'shipped').expect(
      409,
    );
    expect(skipped.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(skipped.body).toMatchObject({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
    });

    await changeStatus(managerToken, shipped.id, 'processing').expect(409);

    const webhookOnly = await changeStatus(
      managerToken,
      paid.id,
      'paid',
    ).expect(422);
    expect(webhookOnly.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(webhookOnly.body).toMatchObject({
      status: 422,
      errors: [{ field: 'status' }],
    });

    await expect(
      prisma.order.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true },
      }),
    ).resolves.toEqual([
      { id: paid.id, status: OrderStatus.PAID },
      { id: shipped.id, status: OrderStatus.SHIPPED },
    ]);
  });

  it('refuses a client the manager transitions and a manager the cancellation', async () => {
    const client = await createClient(prisma);
    const manager = await createManager(prisma);
    const clientToken = await login(client);
    const managerToken = await login(manager);
    const { product, sku } = await createProductWithSku(prisma, {
      stockQuantity: 10,
    });
    const order = await createOrder({
      clientId: client.id,
      product,
      sku,
      status: OrderStatus.PAID,
      totalAmount: '19.99',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    for (const status of ['processing', 'shipped']) {
      await changeStatus(clientToken, order.id, status).expect(403);
    }
    await changeStatus(managerToken, order.id, 'cancelled').expect(403);

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({ status: OrderStatus.PAID, cancelledAt: null });
    // A cancellation of a paid order would have restored this unit.
    await expect(
      prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } }),
    ).resolves.toMatchObject({ stockQuantity: 10 });
  });

  it('lets a client cancel a pending order without changing stock, and refuses a second cancellation', async () => {
    const client = await createClient(prisma);
    const token = await login(client);
    const { product, sku } = await createProductWithSku(prisma, {
      stockQuantity: 10,
    });
    const order = await createOrder({
      clientId: client.id,
      product,
      sku,
      status: OrderStatus.PENDING,
      totalAmount: '19.99',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    const response = await changeStatus(token, order.id, 'cancelled').expect(
      200,
    );
    const cancelled = response.body as OrderResponse;

    expect(cancelled).toMatchObject({
      id: order.id,
      status: 'cancelled',
      paidAt: null,
    });
    expect(typeof cancelled.cancelledAt).toBe('string');

    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe(OrderStatus.CANCELLED);
    expect(stored.cancelledAt?.toISOString()).toBe(cancelled.cancelledAt);
    await expect(
      prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } }),
    ).resolves.toMatchObject({ stockQuantity: 10 });

    const again = await changeStatus(token, order.id, 'cancelled').expect(409);
    expect(again.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(again.body).toMatchObject({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
    });
  });

  it("hides another client's order from a status change", async () => {
    const owner = await createClient(prisma);
    const stranger = await createClient(prisma);
    const strangerToken = await login(stranger);
    const { product, sku } = await createProductWithSku(prisma);
    const order = await createOrder({
      clientId: owner.id,
      product,
      sku,
      status: OrderStatus.PENDING,
      totalAmount: '19.99',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    await changeStatus(strangerToken, order.id, 'cancelled').expect(404);

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({
      status: OrderStatus.PENDING,
      cancelledAt: null,
    });
  });
});
