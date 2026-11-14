import { randomUUID } from 'node:crypto';

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

  it('returns 409 for a SKU already in the cart and keeps the first quantity', async () => {
    const client = await createClient(prisma);
    const token = await login(client);
    const { sku } = await createProductWithSku(prisma, { isActive: true });
    await addItem(token, sku.id, 2).expect(201);

    // The service does not look for the existing item; the unique index
    // uq_cart_sku raises P2002, which the problem filter maps to 409.
    const conflict = await addItem(token, sku.id, 5).expect(409);

    expect(conflict.headers['content-type']).toMatch(
      /^application\/problem\+json/,
    );
    expect(conflict.body).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      instance: '/v1/me/cart/items',
    });
    const cart = (await getCart(token).expect(200)).body as CartResponse;
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ skuId: sku.id, quantity: 2 });
  });

  it('returns 404 for an unknown SKU and for a SKU whose product is inactive', async () => {
    const client = await createClient(prisma);
    const token = await login(client);
    const { sku: hidden } = await createProductWithSku(prisma, {
      isActive: false,
    });

    await addItem(token, randomUUID(), 1).expect(404);
    await addItem(token, hidden.id, 1).expect(404);

    await expect(prisma.cartItem.count()).resolves.toBe(0);
  });

  it("returns 404 for another client's item on PATCH and DELETE, then 204 and 404 for the owner", async () => {
    const owner = await createClient(prisma);
    const other = await createClient(prisma);
    const ownerToken = await login(owner);
    const otherToken = await login(other);
    const { sku } = await createProductWithSku(prisma, { isActive: true });
    const created = await addItem(ownerToken, sku.id, 2).expect(201);
    const itemId = (created.body as CartItemResponse).id;

    await updateItem(otherToken, itemId, 5).expect(404);
    await removeItem(otherToken, itemId).expect(404);

    await expect(
      prisma.cartItem.findUniqueOrThrow({ where: { id: itemId } }),
    ).resolves.toMatchObject({ quantity: 2 });

    const removed = await removeItem(ownerToken, itemId).expect(204);
    expect(removed.text).toBe('');
    await removeItem(ownerToken, itemId).expect(404);
    await updateItem(ownerToken, itemId, 3).expect(404);

    const cart = (await getCart(ownerToken).expect(200)).body as CartResponse;
    expect(cart).toMatchObject({ items: [], subtotalAmount: '0.00' });
  });
});
