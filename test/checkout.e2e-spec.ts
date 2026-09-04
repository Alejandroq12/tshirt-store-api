import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { OrderStatus, PaymentMethod, type User } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import Stripe from 'stripe';

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

interface CreatedOrderBody {
  id: string;
}

interface CreatedIntentBody {
  id: string;
  orderId: string;
  clientSecret: string;
  amount: string;
  currency: string;
}

describe('Checkout and Stripe payments (e2e)', () => {
  const signer = new Stripe('sk_test_signature_only');
  const createPaymentLink = jest.fn();
  const createPaymentIntent = jest.fn();
  const constructEvent = jest.fn(
    (payload: Buffer, signature: string, secret: string) =>
      signer.webhooks.constructEvent(payload, signature, secret),
  );
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = (await createTestApp({
      stripe: { createPaymentLink, createPaymentIntent, constructEvent },
    })) as INestApplication<App>;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.clearAllMocks();
    createPaymentLink.mockResolvedValue({
      id: 'plink_checkout',
      url: 'https://buy.stripe.com/test_checkout',
    });
    createPaymentIntent.mockResolvedValue({
      id: 'pi_checkout',
      client_secret: 'pi_checkout_secret_test',
    });
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

  const postWebhook = (event: object, signature?: string) => {
    const payload = JSON.stringify(event);
    const header =
      signature ??
      signer.webhooks.generateTestHeaderString({
        payload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      });

    return request(app.getHttpServer())
      .post('/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(payload);
  };

  const paymentIntentEvent = (orderId: string, intentId: string) => ({
    id: `evt_${randomUUID()}`,
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: intentId,
        status: 'succeeded',
        metadata: { orderId },
      },
    },
  });

  it('runs cart to order to Payment Intent to one idempotent stock decrement', async () => {
    const client = await createClient(prisma);
    const token = await login(client);
    const { sku } = await createProductWithSku(prisma, {
      isActive: true,
      price: '19.99',
      stockQuantity: 10,
    });

    const cartItem = await request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId: sku.id, quantity: 2 })
      .expect(201);
    const orderResponse = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const order = orderResponse.body as CreatedOrderBody;

    await request(app.getHttpServer())
      .patch(`/v1/me/cart/items/${(cartItem.body as { id: string }).id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 5 })
      .expect(200);

    const intentResponse = await request(app.getHttpServer())
      .post('/v1/payment-intents')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId: order.id })
      .expect(201);
    const intent = intentResponse.body as CreatedIntentBody;

    expect(intent).toEqual({
      id: 'pi_checkout',
      orderId: order.id,
      clientSecret: 'pi_checkout_secret_test',
      amount: '39.98',
      currency: 'USD',
    });
    expect(createPaymentIntent).toHaveBeenCalledWith(
      {
        amount: 3998,
        currency: 'usd',
        metadata: { orderId: order.id },
      },
      { idempotencyKey: order.id },
    );
    await request(app.getHttpServer())
      .post('/v1/payment-intents')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId: order.id })
      .expect(409);
    expect(createPaymentIntent).toHaveBeenCalledTimes(1);
    await expect(
      prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } }),
    ).resolves.toMatchObject({ stockQuantity: 10 });

    const event = paymentIntentEvent(order.id, intent.id);
    await postWebhook(event).expect(204);

    const paidOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const paidSku = await prisma.productSku.findUniqueOrThrow({
      where: { id: sku.id },
    });
    const reconciledItem = await prisma.cartItem.findFirstOrThrow({
      where: { cart: { clientId: client.id }, skuId: sku.id },
    });
    const storedEvent = await prisma.stripeWebhookEvent.findUniqueOrThrow({
      where: { stripeEventId: event.id },
    });

    expect(paidOrder).toMatchObject({
      status: OrderStatus.PAID,
      stripePaymentIntentId: intent.id,
    });
    expect(paidOrder.paidAt).toBeInstanceOf(Date);
    expect(paidSku.stockQuantity).toBe(8);
    expect(reconciledItem.quantity).toBe(3);
    expect(storedEvent).toMatchObject({
      orderId: order.id,
      errorMessage: null,
    });
    expect(storedEvent.processedAt).toBeInstanceOf(Date);

    await postWebhook(event).expect(204);

    await expect(
      prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } }),
    ).resolves.toMatchObject({ stockQuantity: 8 });
    await expect(
      prisma.cartItem.findFirstOrThrow({
        where: { cart: { clientId: client.id }, skuId: sku.id },
      }),
    ).resolves.toMatchObject({ quantity: 3 });
  });

  it('creates a paid Payment Link order only from the webhook and leaves the cart unchanged', async () => {
    const manager = await createManager(prisma);
    const client = await createClient(prisma, { email: 'buyer@example.com' });
    const managerToken = await login(manager);
    const clientToken = await login(client);
    const { product, sku } = await createProductWithSku(prisma, {
      isActive: true,
      price: '25.00',
      stockQuantity: 5,
    });

    await request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ skuId: sku.id, quantity: 4 })
      .expect(201);

    const linkResponse = await request(app.getHttpServer())
      .post('/v1/payment-links')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ skuId: sku.id, quantity: 2 })
      .expect(201);

    expect(linkResponse.body).toMatchObject({
      skuId: sku.id,
      quantity: 2,
      url: 'https://buy.stripe.com/test_checkout',
    });
    await expect(prisma.order.count()).resolves.toBe(0);

    const event = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          payment_link: 'plink_checkout',
          payment_status: 'paid',
          customer_details: { email: client.email.toUpperCase() },
        },
      },
    };
    await postWebhook(event).expect(204);

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { items: true },
    });
    const currentSku = await prisma.productSku.findUniqueOrThrow({
      where: { id: sku.id },
    });
    const cartItem = await prisma.cartItem.findFirstOrThrow({
      where: { cart: { clientId: client.id }, skuId: sku.id },
    });

    expect(order).toMatchObject({
      status: OrderStatus.PAID,
      paymentMethod: PaymentMethod.PAYMENT_LINK,
      stripeCheckoutSessionId: event.data.object.id,
      stripePaymentIntentId: null,
    });
    expect(order.totalAmount.toFixed(2)).toBe('50.00');
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      productId: product.id,
      skuId: sku.id,
      quantity: 2,
    });
    expect(order.items[0].unitPrice.toFixed(2)).toBe('25.00');
    expect(order.items[0].lineTotal.toFixed(2)).toBe('50.00');
    expect(currentSku.stockQuantity).toBe(3);
    expect(cartItem.quantity).toBe(4);
  });

  it('rolls back every payment effect and keeps the event pending when stock changed', async () => {
    const client = await createClient(prisma);
    const token = await login(client);
    const { sku } = await createProductWithSku(prisma, {
      isActive: true,
      stockQuantity: 3,
    });

    await request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ skuId: sku.id, quantity: 2 })
      .expect(201);
    const orderResponse = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const orderId = (orderResponse.body as CreatedOrderBody).id;
    await request(app.getHttpServer())
      .post('/v1/payment-intents')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId })
      .expect(201);

    await prisma.productSku.update({
      where: { id: sku.id },
      data: { stockQuantity: 1 },
    });
    const event = paymentIntentEvent(orderId, 'pi_checkout');
    await postWebhook(event).expect(204);

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toMatchObject({
      status: OrderStatus.PENDING,
      paidAt: null,
      stripePaymentIntentId: 'pi_checkout',
    });
    await expect(
      prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } }),
    ).resolves.toMatchObject({ stockQuantity: 1 });
    await expect(
      prisma.cartItem.findFirstOrThrow({
        where: { cart: { clientId: client.id }, skuId: sku.id },
      }),
    ).resolves.toMatchObject({ quantity: 2 });

    const stored = await prisma.stripeWebhookEvent.findUniqueOrThrow({
      where: { stripeEventId: event.id },
    });
    expect(stored.processedAt).toBeNull();
    expect(stored.errorMessage).toContain('Insufficient stock');
  });

  it('enforces payment authorization, validation, conflicts and safe provider failures', async () => {
    const manager = await createManager(prisma);
    const client = await createClient(prisma);
    const otherClient = await createClient(prisma);
    const managerToken = await login(manager);
    const clientToken = await login(client);
    const otherToken = await login(otherClient);
    const { product, sku } = await createProductWithSku(prisma, {
      isActive: true,
      stockQuantity: 1,
    });

    await request(app.getHttpServer())
      .post('/v1/payment-links')
      .send({ skuId: sku.id, quantity: 1 })
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/payment-links')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ skuId: sku.id, quantity: 1 })
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/payment-links')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ skuId: 'not-a-uuid', quantity: 0 })
      .expect(422);

    await prisma.product.update({
      where: { id: product.id },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .post('/v1/payment-links')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ skuId: sku.id, quantity: 1 })
      .expect(409);
    await prisma.product.update({
      where: { id: product.id },
      data: { isActive: true },
    });

    await request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ skuId: sku.id, quantity: 2 })
      .expect(201);
    const orderResponse = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${clientToken}`)
      .expect(201);
    const orderId = (orderResponse.body as CreatedOrderBody).id;

    await request(app.getHttpServer())
      .post('/v1/payment-intents')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ orderId })
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/payment-intents')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ orderId })
      .expect(404);

    const stockConflict = await request(app.getHttpServer())
      .post('/v1/payment-intents')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ orderId })
      .expect(409);
    expect(stockConflict.body).toMatchObject({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      items: [
        {
          skuId: sku.id,
          requestedQuantity: 2,
          availableQuantity: 1,
        },
      ],
    });

    await prisma.productSku.update({
      where: { id: sku.id },
      data: { stockQuantity: 3 },
    });
    createPaymentIntent.mockRejectedValueOnce(
      new Error('private provider diagnostics'),
    );
    const providerFailure = await request(app.getHttpServer())
      .post('/v1/payment-intents')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ orderId })
      .expect(502);
    expect(providerFailure.body).toEqual({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
      instance: '/v1/payment-intents',
    });
    expect(JSON.stringify(providerFailure.body)).not.toContain(
      'private provider diagnostics',
    );
  });

  it('rejects invalid signatures and unsupported payloads with 400', async () => {
    const invalidSignature = await postWebhook(
      paymentIntentEvent(randomUUID(), 'pi_invalid'),
      'invalid',
    ).expect(400);

    expect(invalidSignature.headers['content-type']).toMatch(
      /^application\/problem\+json/,
    );
    expect(invalidSignature.body).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
    });

    await postWebhook({
      id: `evt_${randomUUID()}`,
      type: 'customer.created',
      data: { object: { id: 'cus_unsupported' } },
    }).expect(400);

    await request(app.getHttpServer())
      .post('/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'invalid')
      .send('{"invalid"')
      .expect(400);

    await expect(prisma.stripeWebhookEvent.count()).resolves.toBe(0);
  });
});
