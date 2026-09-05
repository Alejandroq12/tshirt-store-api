import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus as PrismaOrderStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PROBLEM_TYPE } from '../common/problems';
import type { EnvironmentVariables } from '../config/env.validation';
import type { StockCycleService } from '../notifications/stock-cycle.service';
import type { StockNotificationProducer } from '../notifications/stock-notification.producer';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ListMyOrdersQuery,
  OrderStatusFilter,
  OrderStatusUpdate,
} from './orders.dto';
import { OrdersService } from './orders.service';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const PAID_AT = new Date('2026-09-03T12:05:00.000Z');
const CANCELLED_AT = new Date('2026-09-03T12:10:00.000Z');
const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_A_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PRODUCT_B_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SKU_A_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SKU_B_ID = '99999999-9999-4999-8999-999999999999';

const CLIENT: AuthenticatedUser = {
  id: CLIENT_ID,
  role: 'CLIENT',
  sessionId: '33333333-3333-4333-8333-333333333333',
};
const MANAGER: AuthenticatedUser = {
  id: '44444444-4444-4444-8444-444444444444',
  role: 'MANAGER',
  sessionId: '55555555-5555-4555-8555-555555555555',
};

const ORDER_ITEMS = [
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    orderId: ORDER_ID,
    productId: PRODUCT_A_ID,
    skuId: SKU_A_ID,
    productName: 'Classic Crew',
    skuCode: 'CREW-BLUE-M',
    size: 'M',
    color: 'Blue',
    unitPrice: new Prisma.Decimal('19.99'),
    quantity: 2,
    lineTotal: new Prisma.Decimal('39.98'),
  },
  {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    orderId: ORDER_ID,
    productId: PRODUCT_B_ID,
    skuId: SKU_B_ID,
    productName: 'Heavy Tee',
    skuCode: 'HEAVY-WHITE-S',
    size: 'S',
    color: 'White',
    unitPrice: new Prisma.Decimal('5.50'),
    quantity: 3,
    lineTotal: new Prisma.Decimal('16.50'),
  },
];

type OrderFixture = Prisma.OrderGetPayload<{ include: { items: true } }>;

const orderFixture = (
  status: PrismaOrderStatus,
  overrides: Partial<OrderFixture> = {},
): OrderFixture => ({
  id: ORDER_ID,
  clientId: CLIENT_ID,
  status,
  paymentMethod: PaymentMethod.PAYMENT_INTENT,
  totalAmount: new Prisma.Decimal('56.48'),
  paymentLinkId: null,
  stripeCheckoutSessionId: null,
  stripePaymentIntentId: null,
  paidAt:
    status === PrismaOrderStatus.PAID ||
    status === PrismaOrderStatus.PROCESSING ||
    status === PrismaOrderStatus.SHIPPED
      ? PAID_AT
      : null,
  cancelledAt: status === PrismaOrderStatus.CANCELLED ? CANCELLED_AT : null,
  createdAt: NOW,
  updatedAt: NOW,
  items: ORDER_ITEMS,
  ...overrides,
});

const CART = {
  items: ORDER_ITEMS.map((item) => ({
    quantity: item.quantity,
    sku: {
      id: item.skuId,
      productId: item.productId,
      skuCode: item.skuCode,
      size: item.size,
      color: item.color,
      price: item.unitPrice,
      product: { name: item.productName },
    },
  })),
};

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('database constraint failed', {
    code,
    clientVersion: '6.19.3',
  });

describe('OrdersService', () => {
  const cartFindUnique = jest.fn<
    Promise<unknown>,
    [Prisma.CartFindUniqueArgs]
  >();
  const cartItemUpdate = jest.fn();
  const cartItemDeleteMany = jest.fn();
  const orderFindFirst = jest.fn();
  const orderFindMany = jest.fn();
  const orderCount = jest.fn();
  const orderCreate = jest.fn<Promise<unknown>, [Prisma.OrderCreateArgs]>();
  const orderUpdateMany = jest.fn<
    Promise<{ count: number }>,
    [Prisma.OrderUpdateManyArgs]
  >();
  const orderFindUniqueOrThrow = jest.fn();
  const skuUpdate = jest.fn<Promise<unknown>, [Prisma.ProductSkuUpdateArgs]>();
  const queryRaw = jest.fn<Promise<unknown>, [Prisma.Sql]>();
  const transaction = jest.fn();
  const totalStock = jest.fn();
  const evaluateStockCycle = jest.fn();
  const enqueueNotifications = jest.fn();
  const transactionClient = {
    cart: { findUnique: cartFindUnique },
    cartItem: { update: cartItemUpdate, deleteMany: cartItemDeleteMany },
    order: {
      findFirst: orderFindFirst,
      findMany: orderFindMany,
      count: orderCount,
      create: orderCreate,
      updateMany: orderUpdateMany,
      findUniqueOrThrow: orderFindUniqueOrThrow,
    },
    productSku: { update: skuUpdate },
    $queryRaw: queryRaw,
  };
  const prisma = {
    ...transactionClient,
    $transaction: transaction,
  } as unknown as PrismaService;
  const stockCycle = {
    totalStock,
    evaluate: evaluateStockCycle,
  } as unknown as StockCycleService;
  const notifications = {
    enqueue: enqueueNotifications,
  } as unknown as StockNotificationProducer;
  const service = new OrdersService(prisma, stockCycle, notifications, {
    get: () => 'USD',
  } as unknown as ConfigService<EnvironmentVariables, true>);
  const historyQuery = (
    overrides: Partial<ListMyOrdersQuery> = {},
  ): ListMyOrdersQuery => ({ limit: 10, offset: 0, ...overrides });

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation((input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input as Promise<unknown>[]);
      return (input as (client: Prisma.TransactionClient) => Promise<unknown>)(
        transactionClient as unknown as Prisma.TransactionClient,
      );
    });
    cartFindUnique.mockResolvedValue(CART);
    orderFindFirst.mockResolvedValue(null);
    orderFindMany.mockResolvedValue([]);
    orderCount.mockResolvedValue(0);
    orderCreate.mockResolvedValue(orderFixture(PrismaOrderStatus.PENDING));
    orderUpdateMany.mockResolvedValue({ count: 1 });
    orderFindUniqueOrThrow.mockResolvedValue(
      orderFixture(PrismaOrderStatus.PROCESSING),
    );
    skuUpdate.mockResolvedValue({ id: SKU_A_ID });
    queryRaw.mockResolvedValue([]);
    totalStock.mockResolvedValue(10);
    evaluateStockCycle.mockResolvedValue([]);
    enqueueNotifications.mockResolvedValue(undefined);
  });

  it('snapshots cart fields in stable SKU order and computes totals', async () => {
    await expect(service.createFromCart(CLIENT)).resolves.toEqual({
      id: ORDER_ID,
      clientId: CLIENT_ID,
      status: 'pending',
      paymentMethod: 'payment_intent',
      items: [
        {
          id: ORDER_ITEMS[0].id,
          productId: PRODUCT_A_ID,
          skuId: SKU_A_ID,
          productName: 'Classic Crew',
          skuCode: 'CREW-BLUE-M',
          size: 'M',
          color: 'Blue',
          unitPrice: '19.99',
          quantity: 2,
          lineTotal: '39.98',
        },
        {
          id: ORDER_ITEMS[1].id,
          productId: PRODUCT_B_ID,
          skuId: SKU_B_ID,
          productName: 'Heavy Tee',
          skuCode: 'HEAVY-WHITE-S',
          size: 'S',
          color: 'White',
          unitPrice: '5.50',
          quantity: 3,
          lineTotal: '16.50',
        },
      ],
      totalAmount: '56.48',
      currency: 'USD',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      paidAt: null,
      cancelledAt: null,
    });

    const [createInput] = orderCreate.mock.calls[0];
    const data = createInput.data as unknown as {
      status: PrismaOrderStatus;
      paymentMethod: PaymentMethod;
      totalAmount: Prisma.Decimal;
      items: {
        create: Array<{
          skuId: string;
          productName: string;
          skuCode: string;
          size: string;
          color: string;
          unitPrice: Prisma.Decimal;
          lineTotal: Prisma.Decimal;
        }>;
      };
    };
    expect(data.status).toBe(PrismaOrderStatus.PENDING);
    expect(data.paymentMethod).toBe(PaymentMethod.PAYMENT_INTENT);
    expect(data.totalAmount.toFixed(2)).toBe('56.48');
    expect(
      data.items.create.map((item) => ({
        skuId: item.skuId,
        productName: item.productName,
        skuCode: item.skuCode,
        size: item.size,
        color: item.color,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
      })),
    ).toEqual([
      {
        skuId: SKU_B_ID,
        productName: 'Heavy Tee',
        skuCode: 'HEAVY-WHITE-S',
        size: 'S',
        color: 'White',
        unitPrice: '5.50',
        lineTotal: '16.50',
      },
      {
        skuId: SKU_A_ID,
        productName: 'Classic Crew',
        skuCode: 'CREW-BLUE-M',
        size: 'M',
        color: 'Blue',
        unitPrice: '19.99',
        lineTotal: '39.98',
      },
    ]);
  });

  it('does not create payment, change stock, or change the cart', async () => {
    await service.createFromCart(CLIENT);

    const [cartInput] = cartFindUnique.mock.calls[0];
    expect(cartInput.where).toEqual({ clientId: CLIENT_ID });
    expect(cartInput).not.toHaveProperty(
      'select.items.select.sku.select.stockQuantity',
    );
    expect(skuUpdate).not.toHaveBeenCalled();
    expect(cartItemUpdate).not.toHaveBeenCalled();
    expect(cartItemDeleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['empty', { items: [] }],
  ])(
    'returns the typed empty-cart problem for a %s cart',
    async (_name, cart) => {
      cartFindUnique.mockResolvedValue(cart);

      await expect(service.createFromCart(CLIENT)).rejects.toMatchObject({
        problem: {
          type: PROBLEM_TYPE.EMPTY_CART,
          title: 'Cart is empty',
          status: 409,
        },
      });
      expect(orderFindFirst).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
    },
  );

  it('returns the typed pending-order problem before creating another', async () => {
    orderFindFirst.mockResolvedValue({ id: ORDER_ID });

    await expect(service.createFromCart(CLIENT)).rejects.toMatchObject({
      problem: {
        type: PROBLEM_TYPE.PENDING_ORDER_EXISTS,
        title: 'Pending order already exists',
        status: 409,
      },
    });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('converts a concurrent pending-order collision to the typed problem', async () => {
    orderCreate.mockRejectedValue(prismaError('P2002'));

    await expect(service.createFromCart(CLIENT)).rejects.toMatchObject({
      problem: {
        type: PROBLEM_TYPE.PENDING_ORDER_EXISTS,
        title: 'Pending order already exists',
        status: 409,
      },
    });
  });

  it('does not hide other order-creation failures', async () => {
    const failure = new Error('database unavailable');
    orderCreate.mockRejectedValue(failure);

    await expect(service.createFromCart(CLIENT)).rejects.toBe(failure);
  });

  it("hides another client's order", async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(service.get(ORDER_ID, CLIENT)).rejects.toThrow(
      NotFoundException,
    );
    expect(orderFindFirst).toHaveBeenCalledWith({
      where: { id: ORDER_ID, clientId: CLIENT_ID },
      include: { items: { orderBy: { id: 'asc' } } },
    });
  });

  it('lets a manager read any order without joining the current SKU', async () => {
    const order = orderFixture(PrismaOrderStatus.PAID, {
      clientId: OTHER_CLIENT_ID,
      paymentMethod: PaymentMethod.PAYMENT_LINK,
      paymentLinkId: '77777777-7777-4777-8777-777777777777',
      stripeCheckoutSessionId: 'cs_paid',
    });
    orderFindFirst.mockResolvedValue(order);

    const response = await service.get(ORDER_ID, MANAGER);

    expect(response.id).toBe(ORDER_ID);
    expect(response.clientId).toBe(OTHER_CLIENT_ID);
    expect(response.status).toBe('paid');
    expect(response.paymentMethod).toBe('payment_link');
    expect(response.items[0]).toMatchObject({
      unitPrice: '19.99',
      lineTotal: '39.98',
    });
    expect(orderFindFirst).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      include: { items: { orderBy: { id: 'asc' } } },
    });
  });

  it('lists every client order in the required order and page', async () => {
    orderFindMany.mockResolvedValue([
      orderFixture(PrismaOrderStatus.PROCESSING),
    ]);
    orderCount.mockResolvedValue(1);

    await expect(
      service.list({ limit: 20, offset: 10 }),
    ).resolves.toMatchObject({
      items: [{ id: ORDER_ID, status: 'processing' }],
      pagination: { limit: 20, offset: 10, total: 1 },
    });
    expect(orderFindMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 20,
      include: { items: { orderBy: { id: 'asc' } } },
    });
    expect(orderCount).toHaveBeenCalledWith();
  });

  it('lists every owned status in newest-first order and counts that page', async () => {
    orderFindMany.mockResolvedValue([
      orderFixture(PrismaOrderStatus.PENDING),
      orderFixture(PrismaOrderStatus.CANCELLED),
      orderFixture(PrismaOrderStatus.PAID),
      orderFixture(PrismaOrderStatus.PROCESSING),
      orderFixture(PrismaOrderStatus.SHIPPED),
    ]);
    orderCount.mockResolvedValue(5);

    const response = await service.listMine(historyQuery(), CLIENT);

    expect(response.items.map(({ status }) => status)).toEqual([
      'pending',
      'cancelled',
      'paid',
      'processing',
      'shipped',
    ]);
    expect(response.pagination).toEqual({ limit: 10, offset: 0, total: 5 });
    expect(orderFindMany).toHaveBeenCalledWith({
      where: { clientId: CLIENT_ID },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 10,
      include: { items: { orderBy: { id: 'asc' } } },
    });
    expect(orderCount).toHaveBeenCalledWith({
      where: { clientId: CLIENT_ID },
    });
  });

  it.each<[string, Partial<ListMyOrdersQuery>, Prisma.OrderWhereInput]>([
    [
      'createdAt lower bound',
      { from: '2026-09-01T00:00:00.000Z' },
      { createdAt: { gte: new Date('2026-09-01T00:00:00.000Z') } },
    ],
    [
      'createdAt upper bound',
      { to: '2026-09-02T00:00:00.000Z' },
      { createdAt: { lte: new Date('2026-09-02T00:00:00.000Z') } },
    ],
    [
      'status',
      { status: OrderStatusFilter.CANCELLED },
      { status: PrismaOrderStatus.CANCELLED },
    ],
    [
      'totalAmount lower bound',
      { minPrice: '10.00' },
      { totalAmount: { gte: '10.00' } },
    ],
    [
      'totalAmount upper bound',
      { maxPrice: '50.00' },
      { totalAmount: { lte: '50.00' } },
    ],
  ])('filters by an inclusive %s', async (_name, query, filter) => {
    await service.listMine(historyQuery(query), CLIENT);
    const where = { clientId: CLIENT_ID, ...filter };

    expect(orderFindMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 10,
      include: { items: { orderBy: { id: 'asc' } } },
    });
    expect(orderCount).toHaveBeenCalledWith({ where });
  });

  it.each<[string, Partial<ListMyOrdersQuery>, Prisma.OrderWhereInput]>([
    [
      'date range and status',
      {
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
        status: OrderStatusFilter.PAID,
      },
      {
        createdAt: {
          gte: new Date('2026-09-01T00:00:00.000Z'),
          lte: new Date('2026-09-02T00:00:00.000Z'),
        },
        status: PrismaOrderStatus.PAID,
      },
    ],
    [
      'price range and status',
      {
        minPrice: '10.00',
        maxPrice: '50.00',
        status: OrderStatusFilter.PROCESSING,
      },
      {
        totalAmount: { gte: '10.00', lte: '50.00' },
        status: PrismaOrderStatus.PROCESSING,
      },
    ],
  ])('combines a %s', async (_name, query, filter) => {
    await service.listMine(historyQuery(query), CLIENT);
    const where = { clientId: CLIENT_ID, ...filter };

    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
      }),
    );
    expect(orderCount).toHaveBeenCalledWith({ where });
  });

  it.each([
    [
      'date',
      {
        from: '2026-09-02T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
      },
      'to',
    ],
    ['price', { minPrice: '50.00', maxPrice: '10.00' }, 'maxPrice'],
  ] as const)('refuses an inverted %s range', async (_name, query, field) => {
    await expect(
      service.listMine(historyQuery(query), CLIENT),
    ).rejects.toMatchObject({
      problem: {
        status: 422,
        errors: [expect.objectContaining({ field })],
      },
    });
    expect(orderFindMany).not.toHaveBeenCalled();
    expect(orderCount).not.toHaveBeenCalled();
  });

  it('accepts equal date and price bounds', async () => {
    const at = '2026-09-01T00:00:00.000Z';

    await service.listMine(
      historyQuery({
        from: at,
        to: at,
        minPrice: '10.00',
        maxPrice: '10.00',
      }),
      CLIENT,
    );

    const where = {
      clientId: CLIENT_ID,
      createdAt: { gte: new Date(at), lte: new Date(at) },
      totalAmount: { gte: '10.00', lte: '10.00' },
    };
    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
      }),
    );
    expect(orderCount).toHaveBeenCalledWith({ where });
  });

  it('advances paid to processing for a manager', async () => {
    orderFindFirst.mockResolvedValue(orderFixture(PrismaOrderStatus.PAID));
    orderFindUniqueOrThrow.mockResolvedValue(
      orderFixture(PrismaOrderStatus.PROCESSING),
    );

    await expect(
      service.updateStatus(
        ORDER_ID,
        { status: OrderStatusUpdate.PROCESSING },
        MANAGER,
      ),
    ).resolves.toMatchObject({
      status: 'processing',
      paidAt: PAID_AT.toISOString(),
    });
    expect(orderFindFirst).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: PrismaOrderStatus.PAID },
      data: { status: PrismaOrderStatus.PROCESSING },
    });
    expect(skuUpdate).not.toHaveBeenCalled();
  });

  it('advances processing to shipped for a manager', async () => {
    orderFindFirst.mockResolvedValue(
      orderFixture(PrismaOrderStatus.PROCESSING),
    );
    orderFindUniqueOrThrow.mockResolvedValue(
      orderFixture(PrismaOrderStatus.SHIPPED),
    );

    await expect(
      service.updateStatus(
        ORDER_ID,
        { status: OrderStatusUpdate.SHIPPED },
        MANAGER,
      ),
    ).resolves.toMatchObject({ status: 'shipped' });
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: PrismaOrderStatus.PROCESSING },
      data: { status: PrismaOrderStatus.SHIPPED },
    });
  });

  it('cancels a pending order without restoring stock', async () => {
    orderFindFirst.mockResolvedValue(orderFixture(PrismaOrderStatus.PENDING));
    orderFindUniqueOrThrow.mockResolvedValue(
      orderFixture(PrismaOrderStatus.CANCELLED),
    );

    await expect(
      service.updateStatus(
        ORDER_ID,
        { status: OrderStatusUpdate.CANCELLED },
        CLIENT,
      ),
    ).resolves.toMatchObject({ status: 'cancelled' });
    const [updateInput] = orderUpdateMany.mock.calls[0];
    expect(updateInput.where).toEqual({
      id: ORDER_ID,
      status: PrismaOrderStatus.PENDING,
    });
    expect(updateInput.data.status).toBe(PrismaOrderStatus.CANCELLED);
    expect(updateInput.data.cancelledAt).toBeInstanceOf(Date);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(skuUpdate).not.toHaveBeenCalled();
  });

  it.each([PrismaOrderStatus.PAID, PrismaOrderStatus.PROCESSING])(
    'cancels a %s order and restores every quantity once',
    async (status) => {
      orderFindFirst.mockResolvedValue(orderFixture(status));
      orderFindUniqueOrThrow.mockResolvedValue(
        orderFixture(PrismaOrderStatus.CANCELLED, { paidAt: PAID_AT }),
      );

      await expect(
        service.updateStatus(
          ORDER_ID,
          { status: OrderStatusUpdate.CANCELLED },
          CLIENT,
        ),
      ).resolves.toMatchObject({
        status: 'cancelled',
        paidAt: PAID_AT.toISOString(),
        cancelledAt: CANCELLED_AT.toISOString(),
      });

      expect(queryRaw.mock.calls.map(([query]) => query.values)).toEqual([
        [PRODUCT_B_ID, PRODUCT_A_ID],
        [SKU_B_ID, SKU_A_ID],
      ]);
      expect(queryRaw.mock.calls[0][0].strings.join('')).toContain(
        'FROM products',
      );
      expect(queryRaw.mock.calls[0][0].strings.join('')).toContain('::uuid');
      expect(queryRaw.mock.calls[0][0].strings.join('')).toContain(
        'ORDER BY id',
      );
      expect(queryRaw.mock.calls[0][0].strings.join('')).toContain(
        'FOR UPDATE',
      );
      expect(queryRaw.mock.calls[1][0].strings.join('')).toContain(
        'FROM product_skus',
      );
      expect(queryRaw.mock.calls[1][0].strings.join('')).toContain('::uuid');
      expect(queryRaw.mock.calls[1][0].strings.join('')).toContain(
        'ORDER BY id',
      );
      expect(queryRaw.mock.calls[1][0].strings.join('')).toContain(
        'FOR UPDATE',
      );
      const [updateInput] = orderUpdateMany.mock.calls[0];
      expect(updateInput.where).toEqual({ id: ORDER_ID, status });
      expect(updateInput.data.status).toBe(PrismaOrderStatus.CANCELLED);
      expect(updateInput.data.cancelledAt).toBeInstanceOf(Date);
      expect(skuUpdate).toHaveBeenNthCalledWith(1, {
        where: { id: SKU_B_ID },
        data: { stockQuantity: { increment: 3 } },
        select: { id: true },
      });
      expect(skuUpdate).toHaveBeenNthCalledWith(2, {
        where: { id: SKU_A_ID },
        data: { stockQuantity: { increment: 2 } },
        select: { id: true },
      });
    },
  );

  it('evaluates an upward stock crossing during cancellation and enqueues after commit', async () => {
    orderFindFirst.mockResolvedValue(orderFixture(PrismaOrderStatus.PAID));
    orderFindUniqueOrThrow.mockResolvedValue(
      orderFixture(PrismaOrderStatus.CANCELLED, { paidAt: PAID_AT }),
    );
    totalStock
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5);

    await service.updateStatus(
      ORDER_ID,
      { status: OrderStatusUpdate.CANCELLED },
      CLIENT,
    );

    expect(evaluateStockCycle).toHaveBeenNthCalledWith(
      1,
      transactionClient,
      PRODUCT_B_ID,
      1,
      4,
    );
    expect(evaluateStockCycle).toHaveBeenNthCalledWith(
      2,
      transactionClient,
      PRODUCT_A_ID,
      2,
      5,
    );
    expect(orderFindUniqueOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueNotifications.mock.invocationCallOrder[0],
    );
    expect(enqueueNotifications).toHaveBeenCalledWith([]);
  });

  it.each([
    [PrismaOrderStatus.PENDING, OrderStatusUpdate.PROCESSING],
    [PrismaOrderStatus.PROCESSING, OrderStatusUpdate.PROCESSING],
    [PrismaOrderStatus.SHIPPED, OrderStatusUpdate.PROCESSING],
    [PrismaOrderStatus.CANCELLED, OrderStatusUpdate.PROCESSING],
    [PrismaOrderStatus.PENDING, OrderStatusUpdate.SHIPPED],
    [PrismaOrderStatus.PAID, OrderStatusUpdate.SHIPPED],
    [PrismaOrderStatus.SHIPPED, OrderStatusUpdate.SHIPPED],
    [PrismaOrderStatus.CANCELLED, OrderStatusUpdate.SHIPPED],
  ])('refuses %s to %s', async (from, target) => {
    orderFindFirst.mockResolvedValue(orderFixture(from));

    await expect(
      service.updateStatus(ORDER_ID, { status: target }, MANAGER),
    ).rejects.toThrow(ConflictException);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it.each([PrismaOrderStatus.SHIPPED, PrismaOrderStatus.CANCELLED])(
    'refuses cancellation from %s',
    async (status) => {
      orderFindFirst.mockResolvedValue(orderFixture(status));

      await expect(
        service.updateStatus(
          ORDER_ID,
          { status: OrderStatusUpdate.CANCELLED },
          CLIENT,
        ),
      ).rejects.toThrow(ConflictException);
      expect(skuUpdate).not.toHaveBeenCalled();
    },
  );

  it('returns 409 when a valid transition loses a race', async () => {
    orderFindFirst.mockResolvedValue(orderFixture(PrismaOrderStatus.PAID));
    orderUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateStatus(
        ORDER_ID,
        { status: OrderStatusUpdate.PROCESSING },
        MANAGER,
      ),
    ).rejects.toThrow(ConflictException);
    expect(orderFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('refuses a client asking for a manager transition', async () => {
    await expect(
      service.updateStatus(
        ORDER_ID,
        { status: OrderStatusUpdate.SHIPPED },
        CLIENT,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it('refuses a manager asking to cancel', async () => {
    await expect(
      service.updateStatus(
        ORDER_ID,
        { status: OrderStatusUpdate.CANCELLED },
        MANAGER,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(orderFindFirst).not.toHaveBeenCalled();
  });

  it("hides another client's order during cancellation", async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(
      service.updateStatus(
        ORDER_ID,
        { status: OrderStatusUpdate.CANCELLED },
        CLIENT,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(orderFindFirst).toHaveBeenCalledWith({
      where: { id: ORDER_ID, clientId: CLIENT_ID },
      include: { items: { orderBy: { id: 'asc' } } },
    });
  });
});
