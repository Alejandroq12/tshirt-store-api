import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentMethod, Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { EnvironmentVariables } from '../config/env.validation';
import type { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import type { StripeClient } from './stripe.client';

const SKU_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LINK_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW = new Date('2026-09-04T12:00:00.000Z');

const MANAGER: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'MANAGER',
  sessionId: '22222222-2222-4222-8222-222222222222',
};
const CLIENT: AuthenticatedUser = {
  id: '33333333-3333-4333-8333-333333333333',
  role: 'CLIENT',
  sessionId: '44444444-4444-4444-8444-444444444444',
};

const skuFixture = (overrides: Record<string, unknown> = {}) => ({
  id: SKU_ID,
  skuCode: 'CREW-BLUE-M',
  size: 'M',
  color: 'Blue',
  price: new Prisma.Decimal('19.99'),
  product: {
    id: PRODUCT_ID,
    name: 'Classic Crew',
    isActive: true,
    deletedAt: null,
  },
  ...overrides,
});

const orderFixture = (overrides: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  status: OrderStatus.PENDING,
  paymentMethod: PaymentMethod.PAYMENT_INTENT,
  totalAmount: new Prisma.Decimal('39.98'),
  stripePaymentIntentId: null,
  items: [
    {
      skuId: SKU_ID,
      quantity: 2,
      sku: {
        stockQuantity: 5,
        product: { isActive: true, deletedAt: null },
      },
    },
  ],
  ...overrides,
});

describe('PaymentsService', () => {
  const skuFindUnique = jest.fn();
  const paymentLinkCreate = jest.fn();
  const orderFindFirst = jest.fn();
  const orderUpdateMany = jest.fn();
  const orderCreate = jest.fn();
  const createPaymentLink = jest.fn();
  const createPaymentIntent = jest.fn();
  const prisma = {
    productSku: { findUnique: skuFindUnique },
    paymentLink: { create: paymentLinkCreate },
    order: {
      findFirst: orderFindFirst,
      updateMany: orderUpdateMany,
      create: orderCreate,
    },
  } as unknown as PrismaService;
  const stripe = {
    createPaymentLink,
    createPaymentIntent,
  } as unknown as StripeClient;
  const service = new PaymentsService(prisma, stripe, {
    get: () => 'USD',
  } as unknown as ConfigService<EnvironmentVariables, true>);

  beforeEach(() => {
    jest.clearAllMocks();
    skuFindUnique.mockResolvedValue(skuFixture());
    paymentLinkCreate.mockResolvedValue({
      id: LINK_ID,
      skuId: SKU_ID,
      quantity: 2,
      stripePaymentLinkId: 'plink_1',
      url: 'https://buy.stripe.com/test',
      createdBy: MANAGER.id,
      createdAt: NOW,
    });
    orderFindFirst.mockResolvedValue(orderFixture());
    orderUpdateMany.mockResolvedValue({ count: 1 });
    createPaymentLink.mockResolvedValue({
      id: 'plink_1',
      url: 'https://buy.stripe.com/test',
    });
    createPaymentIntent.mockResolvedValue({
      id: 'pi_1',
      client_secret: 'pi_1_secret_safe',
    });
  });

  it('returns 404 without contacting Stripe when the SKU does not exist', async () => {
    skuFindUnique.mockResolvedValue(null);

    await expect(
      service.createLink({ skuId: SKU_ID, quantity: 2 }, MANAGER),
    ).rejects.toThrow(NotFoundException);
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', { isActive: false, deletedAt: null }],
    ['retired', { isActive: false, deletedAt: NOW }],
  ])('returns 409 for an %s parent product', async (_name, product) => {
    skuFindUnique.mockResolvedValue(skuFixture({ product }));

    await expect(
      service.createLink({ skuId: SKU_ID, quantity: 2 }, MANAGER),
    ).rejects.toThrow(ConflictException);
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it('creates a fixed-quantity link from the database price without creating an order', async () => {
    const response = await service.createLink(
      { skuId: SKU_ID, quantity: 2 },
      MANAGER,
    );

    expect(createPaymentLink).toHaveBeenCalledWith({
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Classic Crew' },
            unit_amount: 1999,
          },
          quantity: 2,
        },
      ],
      metadata: { skuId: SKU_ID, quantity: '2' },
    });
    expect(paymentLinkCreate).toHaveBeenCalledWith({
      data: {
        skuId: SKU_ID,
        quantity: 2,
        stripePaymentLinkId: 'plink_1',
        url: 'https://buy.stripe.com/test',
        createdBy: MANAGER.id,
      },
    });
    expect(orderCreate).not.toHaveBeenCalled();
    expect(response).toEqual({
      id: LINK_ID,
      skuId: SKU_ID,
      quantity: 2,
      url: 'https://buy.stripe.com/test',
      createdAt: NOW.toISOString(),
    });
  });

  it('turns a Payment Link provider failure into a detail-free 502', async () => {
    createPaymentLink.mockRejectedValue(
      new Error('Stripe failed with sk_test_private'),
    );

    const error = await service
      .createLink({ skuId: SKU_ID, quantity: 2 }, MANAGER)
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).getStatus()).toBe(502);
    expect(
      JSON.stringify((error as BadGatewayException).getResponse()),
    ).not.toContain('sk_test_private');
    expect(paymentLinkCreate).not.toHaveBeenCalled();
  });

  it('refuses a manager before looking up a Payment Intent order', async () => {
    await expect(
      service.createIntent({ orderId: ORDER_ID }, MANAGER),
    ).rejects.toThrow(ForbiddenException);
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it('hides an order that does not belong to the client', async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(
      service.createIntent({ orderId: ORDER_ID }, CLIENT),
    ).rejects.toThrow(NotFoundException);
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORDER_ID, clientId: CLIENT.id },
      }),
    );
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

  it.each([
    ['an existing intent', { stripePaymentIntentId: 'pi_existing' }],
    ['a non-pending order', { status: OrderStatus.PAID }],
    ['a Payment Link order', { paymentMethod: PaymentMethod.PAYMENT_LINK }],
    [
      'an inactive product',
      {
        items: [
          {
            skuId: SKU_ID,
            quantity: 2,
            sku: {
              stockQuantity: 5,
              product: { isActive: false, deletedAt: null },
            },
          },
        ],
      },
    ],
  ])('returns 409 for %s', async (_name, override) => {
    orderFindFirst.mockResolvedValue(orderFixture(override));

    await expect(
      service.createIntent({ orderId: ORDER_ID }, CLIENT),
    ).rejects.toThrow(ConflictException);
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

  it('returns every insufficient line in the PaymentIntentConflict body', async () => {
    const otherSkuId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    orderFindFirst.mockResolvedValue(
      orderFixture({
        items: [
          {
            skuId: otherSkuId,
            quantity: 4,
            sku: {
              stockQuantity: 1,
              product: { isActive: true, deletedAt: null },
            },
          },
          {
            skuId: SKU_ID,
            quantity: 2,
            sku: {
              stockQuantity: 0,
              product: { isActive: true, deletedAt: null },
            },
          },
        ],
      }),
    );

    await expect(
      service.createIntent({ orderId: ORDER_ID }, CLIENT),
    ).rejects.toMatchObject({
      problem: {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        items: [
          {
            skuId: SKU_ID,
            requestedQuantity: 2,
            availableQuantity: 0,
          },
          {
            skuId: otherSkuId,
            requestedQuantity: 4,
            availableQuantity: 1,
          },
        ],
      },
    });
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

  it('creates one intent from the frozen total with order idempotency', async () => {
    const response = await service.createIntent({ orderId: ORDER_ID }, CLIENT);

    expect(createPaymentIntent).toHaveBeenCalledWith(
      {
        amount: 3998,
        currency: 'usd',
        metadata: { orderId: ORDER_ID },
      },
      { idempotencyKey: ORDER_ID },
    );
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        clientId: CLIENT.id,
        status: OrderStatus.PENDING,
        stripePaymentIntentId: null,
      },
      data: { stripePaymentIntentId: 'pi_1' },
    });
    expect(response).toEqual({
      id: 'pi_1',
      orderId: ORDER_ID,
      clientSecret: 'pi_1_secret_safe',
      amount: '39.98',
      currency: 'USD',
    });
  });

  it('turns a Payment Intent provider failure into a detail-free 502', async () => {
    createPaymentIntent.mockRejectedValue(new Error('provider secret detail'));

    const error = await service
      .createIntent({ orderId: ORDER_ID }, CLIENT)
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).getStatus()).toBe(502);
    expect(
      JSON.stringify((error as BadGatewayException).getResponse()),
    ).not.toContain('provider secret detail');
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing client secret', { id: 'pi_1', client_secret: null }, 1],
    ['a concurrent claim', { id: 'pi_1', client_secret: 'secret' }, 0],
  ])('does not return credentials after %s', async (_name, intent, count) => {
    createPaymentIntent.mockResolvedValue(intent);
    orderUpdateMany.mockResolvedValue({ count });

    const expected = count === 0 ? ConflictException : BadGatewayException;
    await expect(
      service.createIntent({ orderId: ORDER_ID }, CLIENT),
    ).rejects.toThrow(expected);
  });
});
