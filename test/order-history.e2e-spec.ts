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

import type { OrderPageResponse } from '../src/orders/orders.service';
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

describe('Order history (e2e)', () => {
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

  const history = (token: string) =>
    request(app.getHttpServer())
      .get('/v1/me/orders')
      .set('Authorization', `Bearer ${token}`);

  it("returns only the caller's orders and hides another client's order", async () => {
    const clientA = await createClient(prisma);
    const clientB = await createClient(prisma);
    const token = await login(clientA);
    const { product, sku } = await createProductWithSku(prisma);
    const cancelled = await createOrder({
      clientId: clientA.id,
      product,
      sku,
      status: OrderStatus.CANCELLED,
      totalAmount: '12.00',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    const paid = await createOrder({
      clientId: clientA.id,
      product,
      sku,
      status: OrderStatus.PAID,
      totalAmount: '19.99',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    });
    const foreign = await createOrder({
      clientId: clientB.id,
      product,
      sku,
      status: OrderStatus.PAID,
      totalAmount: '25.00',
      createdAt: new Date('2026-09-03T10:00:00.000Z'),
    });

    const response = await history(token)
      .query({ limit: 10, offset: 0 })
      .expect(200);
    const body = response.body as OrderPageResponse;

    expect(Object.keys(body).sort()).toEqual(['items', 'pagination']);
    expect(body.items.map(({ id }) => id)).toEqual([paid.id, cancelled.id]);
    expect(body.items.map(({ status }) => status)).toEqual([
      'paid',
      'cancelled',
    ]);
    expect(body.items.every(({ clientId }) => clientId === clientA.id)).toBe(
      true,
    );
    expect(body.pagination).toEqual({ limit: 10, offset: 0, total: 2 });
    expect(body.items[0]).toMatchObject({
      paymentMethod: 'payment_intent',
      totalAmount: '19.99',
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

    const filtered = await history(token)
      .query({ limit: 10, offset: 0, status: 'paid' })
      .expect(200);
    expect(
      (filtered.body as OrderPageResponse).items.map(({ id }) => id),
    ).toEqual([paid.id]);
    expect((filtered.body as OrderPageResponse).pagination.total).toBe(1);

    await request(app.getHttpServer())
      .get(`/v1/orders/${foreign.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('requires authentication, client role, and both pagination values', async () => {
    const client = await createClient(prisma);
    const manager = await createManager(prisma);
    const clientToken = await login(client);
    const managerToken = await login(manager);

    await request(app.getHttpServer())
      .get('/v1/me/orders?limit=10&offset=0')
      .expect(401);
    await history(managerToken).query({ limit: 10, offset: 0 }).expect(403);
    await history(clientToken).expect(422);
  });

  it('includes equal bounds and rejects an inverted range', async () => {
    const client = await createClient(prisma);
    const token = await login(client);
    const { product, sku } = await createProductWithSku(prisma);
    const createdAt = new Date('2026-09-02T10:00:00.000Z');
    const order = await createOrder({
      clientId: client.id,
      product,
      sku,
      status: OrderStatus.PAID,
      totalAmount: '19.99',
      createdAt,
    });

    const inclusive = await history(token)
      .query({
        limit: 10,
        offset: 0,
        from: createdAt.toISOString(),
        to: createdAt.toISOString(),
        minPrice: '19.99',
        maxPrice: '19.99',
      })
      .expect(200);
    expect(
      (inclusive.body as OrderPageResponse).items.map(({ id }) => id),
    ).toEqual([order.id]);
    expect((inclusive.body as OrderPageResponse).pagination.total).toBe(1);

    const invalid = await history(token)
      .query({
        limit: 10,
        offset: 0,
        from: '2026-09-03T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
      })
      .expect(422);
    expect(invalid.headers['content-type']).toMatch(
      /^application\/problem\+json/,
    );
    expect(invalid.body).toMatchObject({
      status: 422,
      errors: [{ field: 'to' }],
    });
  });
});
