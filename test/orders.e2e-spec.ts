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

import type {
  OrderPageResponse,
  OrderResponse,
} from '../src/orders/types/orders.types';
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

  const listOrders = (token: string) =>
    request(app.getHttpServer())
      .get('/v1/orders')
      .set('Authorization', `Bearer ${token}`);

  const readOrder = (token: string, orderId: string) =>
    request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`);

  it("lists every client's orders newest first for a manager only", async () => {
    const clientA = await createClient(prisma);
    const clientB = await createClient(prisma);
    const manager = await createManager(prisma);
    const clientToken = await login(clientA);
    const managerToken = await login(manager);
    const { product, sku } = await createProductWithSku(prisma);
    const tie = new Date('2026-09-03T10:00:00.000Z');
    const oldest = await createOrder({
      clientId: clientA.id,
      product,
      sku,
      status: OrderStatus.PAID,
      totalAmount: '19.99',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    const pending = await createOrder({
      clientId: clientB.id,
      product,
      sku,
      status: OrderStatus.PENDING,
      totalAmount: '25.00',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    });
    const tiedA = await createOrder({
      clientId: clientA.id,
      product,
      sku,
      status: OrderStatus.PROCESSING,
      totalAmount: '19.99',
      createdAt: tie,
    });
    const tiedB = await createOrder({
      clientId: clientB.id,
      product,
      sku,
      status: OrderStatus.SHIPPED,
      totalAmount: '25.00',
      createdAt: tie,
    });
    // PostgreSQL compares uuid values byte by byte, which is the order of
    // their lowercase hex strings, so the id DESC tie-break can be derived here.
    const newestFirst = [
      ...[tiedA.id, tiedB.id].sort().reverse(),
      pending.id,
      oldest.id,
    ];

    const response = await listOrders(managerToken)
      .query({ limit: 10, offset: 0 })
      .expect(200);
    const body = response.body as OrderPageResponse;

    expect(Object.keys(body).sort()).toEqual(['items', 'pagination']);
    expect(body.items.map(({ id }) => id)).toEqual(newestFirst);
    expect(new Set(body.items.map(({ clientId }) => clientId))).toEqual(
      new Set([clientA.id, clientB.id]),
    );
    expect(body.pagination).toEqual({ limit: 10, offset: 0, total: 4 });

    const page = await listOrders(managerToken)
      .query({ limit: 1, offset: 2 })
      .expect(200);
    expect((page.body as OrderPageResponse).items.map(({ id }) => id)).toEqual([
      pending.id,
    ]);
    expect((page.body as OrderPageResponse).pagination).toEqual({
      limit: 1,
      offset: 2,
      total: 4,
    });

    await request(app.getHttpServer())
      .get('/v1/orders?limit=10&offset=0')
      .expect(401);
    await listOrders(clientToken).query({ limit: 10, offset: 0 }).expect(403);

    const missingOffset = await listOrders(managerToken)
      .query({ limit: 10 })
      .expect(422);
    expect(missingOffset.headers['content-type']).toMatch(PROBLEM_JSON);
    const fields = (
      missingOffset.body as { errors: { field: string }[] }
    ).errors.map(({ field }) => field);
    expect([...new Set(fields)]).toEqual(['offset']);
  });

  it('lets the owner and a manager read an order and rejects a malformed id', async () => {
    const owner = await createClient(prisma);
    const manager = await createManager(prisma);
    const ownerToken = await login(owner);
    const managerToken = await login(manager);
    const { product, sku } = await createProductWithSku(prisma);
    const createdAt = new Date('2026-09-01T10:00:00.000Z');
    const order = await createOrder({
      clientId: owner.id,
      product,
      sku,
      status: OrderStatus.SHIPPED,
      totalAmount: '19.99',
      createdAt,
    });

    for (const token of [ownerToken, managerToken]) {
      const response = await readOrder(token, order.id).expect(200);

      expect(response.body).toMatchObject({
        id: order.id,
        clientId: owner.id,
        status: 'shipped',
        paymentMethod: 'payment_intent',
        totalAmount: '19.99',
        paidAt: createdAt.toISOString(),
        cancelledAt: null,
        items: [
          {
            productId: product.id,
            skuId: sku.id,
            quantity: 1,
            unitPrice: '19.99',
            lineTotal: '19.99',
          },
        ],
      });
    }

    const malformed = await readOrder(ownerToken, 'not-a-uuid').expect(422);
    expect(malformed.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(malformed.body).toMatchObject({
      status: 422,
      errors: [{ field: 'orderId' }],
    });
  });

  const checkout = (token: string) =>
    request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${token}`);

  it('returns the typed 409 problems for an empty cart and a second pending order', async () => {
    const client = await createClient(prisma);
    const token = await login(client);
    const { sku } = await createProductWithSku(prisma, {
      isActive: true,
      price: '19.99',
      stockQuantity: 10,
    });

    const emptyCart = await checkout(token).expect(409);
    expect(emptyCart.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(emptyCart.body).toEqual({
      type: 'urn:tshirt-store:problem:empty-cart',
      title: 'Cart is empty',
      status: 409,
      instance: '/v1/orders',
    });

    await request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId: sku.id, quantity: 2 })
      .expect(201);

    const created = await checkout(token).expect(201);
    const order = created.body as OrderResponse;
    expect(created.headers.location).toBe(`/v1/orders/${order.id}`);
    expect(order).toMatchObject({
      clientId: client.id,
      status: 'pending',
      totalAmount: '39.98',
      paidAt: null,
      cancelledAt: null,
    });

    // The cart keeps its items after checkout, so this request reaches the
    // pending-order check rather than the empty-cart one.
    const second = await checkout(token).expect(409);
    expect(second.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(second.body).toEqual({
      type: 'urn:tshirt-store:problem:pending-order-exists',
      title: 'Pending order already exists',
      status: 409,
      instance: '/v1/orders',
    });
    await expect(prisma.order.count()).resolves.toBe(1);
  });
});
