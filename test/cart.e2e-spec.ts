import { INestApplication } from '@nestjs/common';
import type { User } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

import type {
  CartItemResponse,
  CartResponse,
} from '../src/cart/types/cart.types';
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

describe('Cart (e2e)', () => {
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

  const getCart = (token: string) =>
    request(app.getHttpServer())
      .get('/v1/me/cart')
      .set('Authorization', `Bearer ${token}`);

  const addItem = (token: string, skuId: string, quantity: number) =>
    request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId, quantity });

  const updateItem = (token: string, itemId: string, quantity: number) =>
    request(app.getHttpServer())
      .patch(`/v1/me/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity });

  const removeItem = (token: string, itemId: string) =>
    request(app.getHttpServer())
      .delete(`/v1/me/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);

  it('creates an empty cart on first access and returns the same cart afterwards', async () => {
    const client = await createClient(prisma);
    const token = await login(client);

    const first = await getCart(token).expect(200);
    const second = await getCart(token).expect(200);

    const cart = first.body as CartResponse;
    expect(cart).toMatchObject({
      items: [],
      subtotalAmount: '0.00',
      currency: 'USD',
    });
    expect(typeof cart.updatedAt).toBe('string');
    expect((second.body as CartResponse).id).toBe(cart.id);
    await expect(
      prisma.cart.count({ where: { clientId: client.id } }),
    ).resolves.toBe(1);
  });

  it('refuses anonymous callers and managers on every cart operation', async () => {
    const client = await createClient(prisma);
    const manager = await createManager(prisma);
    const clientToken = await login(client);
    const managerToken = await login(manager);
    const { sku } = await createProductWithSku(prisma, { isActive: true });
    const created = await addItem(clientToken, sku.id, 1).expect(201);
    const itemId = (created.body as CartItemResponse).id;

    await request(app.getHttpServer()).get('/v1/me/cart').expect(401);
    await request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .send({ skuId: sku.id, quantity: 1 })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/v1/me/cart/items/${itemId}`)
      .send({ quantity: 2 })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/v1/me/cart/items/${itemId}`)
      .expect(401);

    await getCart(managerToken).expect(403);
    await addItem(managerToken, sku.id, 1).expect(403);
    await updateItem(managerToken, itemId, 2).expect(403);
    await removeItem(managerToken, itemId).expect(403);

    // A refused call must not reach the service: the item keeps its quantity
    // and no cart is created for the manager.
    await expect(
      prisma.cartItem.findUniqueOrThrow({ where: { id: itemId } }),
    ).resolves.toMatchObject({ quantity: 1 });
    await expect(
      prisma.cart.count({ where: { clientId: manager.id } }),
    ).resolves.toBe(0);
  });
});
