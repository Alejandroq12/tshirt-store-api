import { randomUUID } from 'node:crypto';

import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { OrderStatus, PaymentMethod, type User } from '@prisma/client';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type { App } from 'supertest/types';
import Stripe from 'stripe';

import { STOCK_NOTIFICATION_QUEUE } from '../src/notifications/stock-notification.queue';
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
  const sendMail = jest.fn();
  const constructEvent = jest.fn(
    (payload: Buffer, signature: string, secret: string) =>
      signer.webhooks.constructEvent(payload, signature, secret),
  );
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = (await createTestApp({
      mail: { send: sendMail },
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
    sendMail.mockResolvedValue(undefined);
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

  const waitForSentNotifications = async (expected: number) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const notifications = await prisma.stockNotification.findMany({
        orderBy: [{ lowStockCycle: 'asc' }, { clientId: 'asc' }],
      });
      if (
        notifications.length === expected &&
        notifications.every(({ sentAt }) => sentAt !== null)
      ) {
        return notifications;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Expected ${expected} sent stock notifications`);
  };

  it('isolates BullMQ keys from development', () => {
    const queue = app.get<Queue>(getQueueToken(STOCK_NOTIFICATION_QUEUE));

    expect(queue.opts.prefix).toBe('{tshirt-test}');
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

  it('delivers one queued email per eligible client and low-stock cycle', async () => {
    const manager = await createManager(prisma);
    const buyer = await createClient(prisma, { email: 'buyer@example.com' });
    const interested = await createClient(prisma, {
      email: 'interested@example.com',
    });
    const managerToken = await login(manager);
    const buyerToken = await login(buyer);
    const interestedToken = await login(interested);
    const { product, sku } = await createProductWithSku(prisma, {
      isActive: true,
      stockQuantity: 5,
    });
    const imageUrl = 'https://cdn.example.com/classic-crew.webp';
    await prisma.productImage.create({
      data: {
        productId: product.id,
        url: imageUrl,
        s3Key: `products/${product.id}/classic-crew.webp`,
        isFallback: true,
        isProductPrimary: true,
      },
    });

    for (const token of [buyerToken, interestedToken]) {
      await request(app.getHttpServer())
        .patch(`/v1/products/${product.id}/like`)
        .set('Authorization', `Bearer ${token}`)
        .send({ liked: true })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ skuId: sku.id, quantity: 3 })
      .expect(201);
    const orderResponse = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(201);
    const orderId = (orderResponse.body as CreatedOrderBody).id;
    await request(app.getHttpServer())
      .post('/v1/payment-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ orderId })
      .expect(201);
    await postWebhook(paymentIntentEvent(orderId, 'pi_checkout')).expect(204);

    const firstCycle = await waitForSentNotifications(1);
    expect(firstCycle[0]).toMatchObject({
      clientId: interested.id,
      productId: product.id,
      lowStockCycle: 0,
      stockAtSend: 2,
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: interested.email,
        html: expect.stringContaining(imageUrl) as string,
      }),
    );

    await request(app.getHttpServer())
      .patch(`/v1/skus/${sku.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ stockQuantity: 1 })
      .expect(200);
    await expect(prisma.stockNotification.count()).resolves.toBe(1);

    await request(app.getHttpServer())
      .patch(`/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ status: 'cancelled' })
      .expect(200);
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).resolves.toMatchObject({ lowStockCycle: 1 });

    await request(app.getHttpServer())
      .patch(`/v1/skus/${sku.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ stockQuantity: 3 })
      .expect(200);

    const allCycles = await waitForSentNotifications(3);
    expect(
      allCycles.map(({ clientId, lowStockCycle }) => ({
        clientId,
        lowStockCycle,
      })),
    ).toEqual([
      { clientId: interested.id, lowStockCycle: 0 },
      ...[buyer.id, interested.id]
        .sort()
        .map((clientId) => ({ clientId, lowStockCycle: 1 })),
    ]);
    expect(
      sendMail.mock.calls
        .map(([message]: [{ to: string }]) => message.to)
        .sort(),
    ).toEqual([buyer.email, interested.email, interested.email].sort());
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

    await prisma.productSku.update({
      where: { id: sku.id },
      data: { price: '30.00' },
    });

    const event = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          payment_link: 'plink_checkout',
          payment_status: 'paid',
          amount_total: 5000,
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
