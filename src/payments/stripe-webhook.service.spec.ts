import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import type Stripe from 'stripe';

import type { EnvironmentVariables } from '../config/env.validation';
import type { PrismaService } from '../prisma/prisma.service';
import { StripeWebhookService } from './stripe-webhook.service';
import type { StripeClient } from './stripe.client';

const STORED_EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const LINK_ID = '44444444-4444-4444-8444-444444444444';
const PRODUCT_A_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PRODUCT_B_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SKU_A_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SKU_B_ID = '99999999-9999-4999-8999-999999999999';
const EVENT_TIME = 1_788_523_200;

const paymentIntentEvent = {
  id: 'evt_intent',
  type: 'payment_intent.succeeded',
  created: EVENT_TIME,
  data: {
    object: {
      id: 'pi_1',
      status: 'succeeded',
      metadata: { orderId: ORDER_ID },
    },
  },
} as unknown as Stripe.PaymentIntentSucceededEvent;

const checkoutEvent = {
  id: 'evt_checkout',
  type: 'checkout.session.completed',
  created: EVENT_TIME,
  data: {
    object: {
      id: 'cs_1',
      payment_link: 'plink_1',
      payment_status: 'paid',
      amount_total: 3998,
      customer_details: { email: 'client@example.com' },
      customer_email: null,
    },
  },
} as unknown as Stripe.CheckoutSessionCompletedEvent;

const inventory = [
  {
    id: SKU_A_ID,
    productId: PRODUCT_A_ID,
    skuCode: 'A-BLUE-M',
    size: 'M',
    color: 'Blue',
    price: new Prisma.Decimal('19.99'),
    stockQuantity: 5,
    product: { name: 'Shirt A', isActive: true, deletedAt: null },
  },
  {
    id: SKU_B_ID,
    productId: PRODUCT_B_ID,
    skuCode: 'B-WHITE-S',
    size: 'S',
    color: 'White',
    price: new Prisma.Decimal('5.00'),
    stockQuantity: 4,
    product: { name: 'Shirt B', isActive: true, deletedAt: null },
  },
];

const intentOrder = {
  id: ORDER_ID,
  clientId: CLIENT_ID,
  status: OrderStatus.PENDING,
  paymentMethod: PaymentMethod.PAYMENT_INTENT,
  stripePaymentIntentId: 'pi_1',
  items: [
    { skuId: SKU_A_ID, productId: PRODUCT_A_ID, quantity: 2 },
    { skuId: SKU_B_ID, productId: PRODUCT_B_ID, quantity: 1 },
  ],
};

const storedEvent = (event: Stripe.Event, processedAt: Date | null = null) => ({
  id: STORED_EVENT_ID,
  stripeEventId: event.id,
  eventType: event.type,
  orderId: null,
  payload: event,
  processedAt,
  errorMessage: null,
  createdAt: new Date(EVENT_TIME * 1000),
});

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('database constraint failed', {
    code,
    clientVersion: '6.19.3',
  });

describe('StripeWebhookService', () => {
  const eventFindUniqueOutside = jest.fn();
  const eventCreate = jest.fn();
  const eventUpdateOutside = jest.fn();
  const eventFindUnique = jest.fn();
  const eventUpdate = jest.fn();
  const orderFindUnique = jest.fn();
  const orderUpdateMany = jest.fn();
  const orderCreate = jest.fn();
  const paymentLinkFindUnique = jest.fn();
  const userFindFirst = jest.fn();
  const skuFindMany = jest.fn();
  const skuUpdate = jest.fn();
  const cartItemUpdate = jest.fn();
  const cartItemDeleteMany = jest.fn();
  const queryRaw = jest.fn();
  const transaction = jest.fn();
  const constructEvent = jest.fn();
  let lockedCartItems: LockedCartFixture[];

  interface LockedCartFixture {
    id: string;
    skuId: string;
    quantity: number;
  }

  interface EventUpdateFixture {
    where: { id: string };
    data: {
      orderId: string;
      processedAt: unknown;
      errorMessage: null;
    };
  }

  const transactionClient = {
    stripeWebhookEvent: {
      findUnique: eventFindUnique,
      update: eventUpdate,
    },
    order: {
      findUnique: orderFindUnique,
      updateMany: orderUpdateMany,
      create: orderCreate,
    },
    paymentLink: { findUnique: paymentLinkFindUnique },
    user: { findFirst: userFindFirst },
    productSku: { findMany: skuFindMany, update: skuUpdate },
    cartItem: { update: cartItemUpdate, deleteMany: cartItemDeleteMany },
    $queryRaw: queryRaw,
  };
  const prisma = {
    stripeWebhookEvent: {
      findUnique: eventFindUniqueOutside,
      create: eventCreate,
      updateMany: eventUpdateOutside,
    },
    $transaction: transaction,
  } as unknown as PrismaService;
  const stripe = { constructEvent } as unknown as StripeClient;
  const service = new StripeWebhookService(prisma, stripe, {
    get: () => 'whsec_test',
  } as unknown as ConfigService<EnvironmentVariables, true>);

  beforeEach(() => {
    jest.clearAllMocks();
    lockedCartItems = [];
    transaction.mockImplementation(
      (work: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        work(transactionClient as unknown as Prisma.TransactionClient),
    );
    queryRaw.mockImplementation((query: Prisma.Sql) =>
      Promise.resolve(
        query.strings.join('').includes('FROM cart_items')
          ? lockedCartItems
          : [],
      ),
    );
    eventFindUniqueOutside.mockResolvedValue(null);
    eventCreate.mockResolvedValue({ id: STORED_EVENT_ID });
    eventFindUnique.mockResolvedValue(storedEvent(paymentIntentEvent));
    eventUpdate.mockResolvedValue({ id: STORED_EVENT_ID });
    eventUpdateOutside.mockResolvedValue({ count: 1 });
    orderFindUnique.mockResolvedValue(intentOrder);
    orderUpdateMany.mockResolvedValue({ count: 1 });
    orderCreate.mockResolvedValue({ id: ORDER_ID });
    paymentLinkFindUnique.mockResolvedValue({
      id: LINK_ID,
      skuId: SKU_A_ID,
      quantity: 2,
      sku: { productId: PRODUCT_A_ID },
    });
    userFindFirst.mockResolvedValue({ id: CLIENT_ID });
    skuFindMany.mockResolvedValue(inventory);
    skuUpdate.mockResolvedValue({ id: SKU_A_ID });
    cartItemUpdate.mockResolvedValue({ id: 'cart-item' });
    cartItemDeleteMany.mockResolvedValue({ count: 1 });
    constructEvent.mockReturnValue(paymentIntentEvent);
  });

  it('returns 400 for a missing or invalid signature without storing an event', async () => {
    await expect(service.receive(Buffer.from('{}'))).rejects.toThrow(
      BadRequestException,
    );

    constructEvent.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    await expect(service.receive(Buffer.from('{}'), 'invalid')).rejects.toThrow(
      BadRequestException,
    );
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('acknowledges an existing event without applying it again', async () => {
    eventFindUniqueOutside.mockResolvedValue({ id: STORED_EVENT_ID });
    const process = jest.spyOn(service, 'process');

    await expect(
      service.receive(Buffer.from('{}'), 'signature'),
    ).resolves.toBeUndefined();

    expect(eventCreate).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
    process.mockRestore();
  });

  it('stores a verified event before starting business processing', async () => {
    const process = jest.spyOn(service, 'process').mockResolvedValue();

    await service.receive(Buffer.from('{"id":"evt_intent"}'), 'signature');

    expect(constructEvent).toHaveBeenCalledWith(
      Buffer.from('{"id":"evt_intent"}'),
      'signature',
      'whsec_test',
    );
    expect(eventCreate).toHaveBeenCalledWith({
      data: {
        stripeEventId: paymentIntentEvent.id,
        eventType: paymentIntentEvent.type,
        payload: paymentIntentEvent,
      },
      select: { id: true },
    });
    expect(eventCreate.mock.invocationCallOrder[0]).toBeLessThan(
      process.mock.invocationCallOrder[0],
    );
    process.mockRestore();
  });

  it('treats a concurrent duplicate insert as an acknowledged event', async () => {
    eventCreate.mockRejectedValue(prismaError('P2002'));
    const process = jest.spyOn(service, 'process');

    await expect(
      service.receive(Buffer.from('{}'), 'signature'),
    ).resolves.toBeUndefined();
    expect(process).not.toHaveBeenCalled();
    process.mockRestore();
  });

  it('locks products and SKUs in ascending order and commits payment atomically', async () => {
    lockedCartItems = [
      { id: 'cart-a', skuId: SKU_A_ID, quantity: 5 },
      { id: 'cart-b', skuId: SKU_B_ID, quantity: 1 },
    ];

    await service.process(STORED_EVENT_ID);

    const sql = queryRaw.mock.calls.map(([query]: [Prisma.Sql]) => ({
      text: query.strings.join(''),
      values: query.values,
    }));
    expect(sql[0]?.text).toContain('stripe_webhook_events');
    expect(sql[0]?.values).toEqual([STORED_EVENT_ID]);
    expect(sql[1]?.text).toContain('ORDER BY id FOR UPDATE');
    expect(sql[1]?.values).toEqual([PRODUCT_B_ID, PRODUCT_A_ID]);
    expect(sql[2]?.text).toContain('ORDER BY id FOR UPDATE');
    expect(sql[2]?.values).toEqual([SKU_B_ID, SKU_A_ID]);
    expect(skuUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: SKU_B_ID },
      data: { stockQuantity: { decrement: 1 } },
      select: { id: true },
    });
    expect(skuUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: SKU_A_ID },
      data: { stockQuantity: { decrement: 2 } },
      select: { id: true },
    });
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.PAYMENT_INTENT,
        stripePaymentIntentId: 'pi_1',
      },
      data: {
        status: OrderStatus.PAID,
        stripePaymentIntentId: 'pi_1',
        paidAt: new Date(EVENT_TIME * 1000),
      },
    });
    const eventUpdateCalls = eventUpdate.mock.calls as unknown as Array<
      [EventUpdateFixture]
    >;
    const eventUpdateInput = eventUpdateCalls[0]?.[0];
    if (!eventUpdateInput) throw new Error('Missing event update call');
    expect(eventUpdateInput.where).toEqual({ id: STORED_EVENT_ID });
    expect(eventUpdateInput.data.orderId).toBe(ORDER_ID);
    expect(eventUpdateInput.data.processedAt).toBeInstanceOf(Date);
    expect(eventUpdateInput.data.errorMessage).toBeNull();
    expect(eventUpdateOutside).not.toHaveBeenCalled();
  });

  it('refuses a succeeded intent that is not the one stored on the order', async () => {
    orderFindUnique.mockResolvedValue({
      ...intentOrder,
      stripePaymentIntentId: 'pi_other',
    });

    await expect(service.process(STORED_EVENT_ID)).rejects.toThrow(
      'Payment Intent order cannot be paid',
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(skuUpdate).not.toHaveBeenCalled();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(eventUpdateOutside).toHaveBeenCalled();
  });

  it('decrements nothing and leaves the event pending when any line lacks stock', async () => {
    skuFindMany.mockResolvedValue([
      inventory[0],
      { ...inventory[1], stockQuantity: 0 },
    ]);

    await expect(service.process(STORED_EVENT_ID)).rejects.toThrow(
      `Insufficient stock for SKU ${SKU_B_ID}`,
    );

    expect(skuUpdate).not.toHaveBeenCalled();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(eventUpdate).not.toHaveBeenCalled();
    expect(eventUpdateOutside).toHaveBeenCalledWith({
      where: { id: STORED_EVENT_ID, processedAt: null },
      data: { errorMessage: `Insufficient stock for SKU ${SKU_B_ID}` },
    });
  });

  it.each([
    ['keeps a positive remainder', 5, 'update', 3],
    ['deletes an exact remainder', 2, 'delete', 0],
    ['ignores a missing cart row', null, 'none', 0],
  ] as const)(
    '%s during Payment Intent cart reconciliation',
    async (_name, current, operation, remainder) => {
      lockedCartItems =
        current === null
          ? []
          : [{ id: 'cart-a', skuId: SKU_A_ID, quantity: current }];

      await service.process(STORED_EVENT_ID);

      if (operation === 'update') {
        expect(cartItemUpdate).toHaveBeenCalledWith({
          where: { id: 'cart-a' },
          data: { quantity: remainder },
          select: { id: true },
        });
        expect(cartItemDeleteMany).not.toHaveBeenCalled();
      } else if (operation === 'delete') {
        expect(cartItemDeleteMany).toHaveBeenCalledWith({
          where: { id: 'cart-a' },
        });
        expect(cartItemUpdate).not.toHaveBeenCalled();
      } else {
        expect(cartItemUpdate).not.toHaveBeenCalled();
        expect(cartItemDeleteMany).not.toHaveBeenCalled();
      }
    },
  );

  it('creates a paid Payment Link order without touching the cart', async () => {
    eventFindUnique.mockResolvedValue(storedEvent(checkoutEvent));
    orderFindUnique.mockResolvedValue(null);
    skuFindMany.mockResolvedValue([inventory[0]]);

    await service.process(STORED_EVENT_ID);

    expect(userFindFirst).toHaveBeenCalledWith({
      where: { email: 'client@example.com', role: 'CLIENT' },
      select: { id: true },
    });
    expect(orderCreate).toHaveBeenCalledWith({
      data: {
        clientId: CLIENT_ID,
        status: OrderStatus.PAID,
        paymentMethod: PaymentMethod.PAYMENT_LINK,
        totalAmount: new Prisma.Decimal('39.98'),
        paymentLinkId: LINK_ID,
        stripeCheckoutSessionId: 'cs_1',
        paidAt: new Date(EVENT_TIME * 1000),
        items: {
          create: {
            skuId: SKU_A_ID,
            productId: PRODUCT_A_ID,
            productName: 'Shirt A',
            skuCode: 'A-BLUE-M',
            size: 'M',
            color: 'Blue',
            unitPrice: new Prisma.Decimal('19.99'),
            quantity: 2,
            lineTotal: new Prisma.Decimal('39.98'),
          },
        },
      },
      select: { id: true },
    });
    expect(
      queryRaw.mock.calls.some(([query]: [Prisma.Sql]) =>
        query.strings.join('').includes('FROM cart_items'),
      ),
    ).toBe(false);
    expect(cartItemUpdate).not.toHaveBeenCalled();
    expect(cartItemDeleteMany).not.toHaveBeenCalled();
  });

  it('records what Stripe charged when the SKU price moved after link creation', async () => {
    eventFindUnique.mockResolvedValue(storedEvent(checkoutEvent));
    orderFindUnique.mockResolvedValue(null);
    skuFindMany.mockResolvedValue([
      { ...inventory[0], price: new Prisma.Decimal('30.00') },
    ]);

    await service.process(STORED_EVENT_ID);

    const [{ data }] = orderCreate.mock.calls[0] as [
      { data: { totalAmount: Prisma.Decimal; items: { create: unknown } } },
    ];

    expect(data.totalAmount).toEqual(new Prisma.Decimal('39.98'));
    expect(data.items.create).toMatchObject({
      unitPrice: new Prisma.Decimal('19.99'),
      lineTotal: new Prisma.Decimal('39.98'),
    });
  });

  it('leaves an unmatched Payment Link event pending', async () => {
    eventFindUnique.mockResolvedValue(storedEvent(checkoutEvent));
    orderFindUnique.mockResolvedValue(null);
    userFindFirst.mockResolvedValue(null);

    await expect(service.process(STORED_EVENT_ID)).rejects.toThrow(
      'Checkout Session cannot be matched locally',
    );
    expect(orderCreate).not.toHaveBeenCalled();
    expect(skuUpdate).not.toHaveBeenCalled();
    expect(eventUpdateOutside).toHaveBeenCalled();
  });

  it('does no business work when a stored event is already processed', async () => {
    eventFindUnique.mockResolvedValue(
      storedEvent(paymentIntentEvent, new Date()),
    );

    await service.process(STORED_EVENT_ID);

    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(skuUpdate).not.toHaveBeenCalled();
    expect(eventUpdate).not.toHaveBeenCalled();
  });
});
