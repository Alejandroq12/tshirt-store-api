import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { EnvironmentVariables } from '../config/env.validation';
import type { PrismaService } from '../prisma/prisma.service';
import { CartService } from './cart.service';

const NOW = new Date('2026-09-03T12:00:00.000Z');
const CART_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SKU_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRODUCT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CLIENT: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'CLIENT',
  sessionId: '22222222-2222-4222-8222-222222222222',
};
const ITEM = {
  id: ITEM_ID,
  skuId: SKU_ID,
  quantity: 3,
  sku: {
    productId: PRODUCT_ID,
    skuCode: 'CREW-BLUE-M',
    size: 'M',
    color: 'Blue',
    price: new Prisma.Decimal('12.50'),
    product: { name: 'Classic Crew' },
  },
};
const SECOND_ITEM = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  skuId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  quantity: 2,
  sku: {
    productId: PRODUCT_ID,
    skuCode: 'CREW-WHITE-S',
    size: 'S',
    color: 'White',
    price: new Prisma.Decimal('5.25'),
    product: { name: 'Classic Crew' },
  },
};

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('database constraint failed', {
    code,
    clientVersion: '6.19.3',
  });

describe('CartService', () => {
  const cartUpsert = jest.fn();
  const cartFindUniqueOrThrow = jest.fn();
  const skuFindFirst = jest.fn();
  const itemCreate = jest.fn<
    Promise<typeof ITEM>,
    [Prisma.CartItemCreateArgs]
  >();
  const itemFindFirst = jest.fn();
  const itemUpdate = jest.fn();
  const itemDeleteMany = jest.fn();
  const prisma = {
    cart: {
      upsert: cartUpsert,
      findUniqueOrThrow: cartFindUniqueOrThrow,
    },
    productSku: { findFirst: skuFindFirst },
    cartItem: {
      create: itemCreate,
      findFirst: itemFindFirst,
      update: itemUpdate,
      deleteMany: itemDeleteMany,
    },
  } as unknown as PrismaService;
  const service = new CartService(prisma, {
    get: () => 'USD',
  } as unknown as ConfigService<EnvironmentVariables, true>);

  beforeEach(() => {
    jest.clearAllMocks();
    cartUpsert.mockResolvedValue({ id: CART_ID });
    cartFindUniqueOrThrow.mockResolvedValue({
      id: CART_ID,
      items: [],
      updatedAt: NOW,
    });
    skuFindFirst.mockResolvedValue({ id: SKU_ID });
    itemCreate.mockResolvedValue(ITEM);
    itemFindFirst.mockResolvedValue({ id: ITEM_ID });
    itemUpdate.mockResolvedValue(ITEM);
    itemDeleteMany.mockResolvedValue({ count: 1 });
  });

  it('creates an empty cart on first access and represents its zero subtotal', async () => {
    await expect(service.getOrCreate(CLIENT)).resolves.toEqual({
      id: CART_ID,
      items: [],
      subtotalAmount: '0.00',
      currency: 'USD',
      updatedAt: NOW.toISOString(),
    });
    expect(cartUpsert).toHaveBeenCalledWith({
      where: { clientId: CLIENT.id },
      create: { clientId: CLIENT.id },
      update: {},
      select: { id: true },
    });
  });

  it('returns the same cart on later access with current-price totals', async () => {
    cartFindUniqueOrThrow
      .mockResolvedValueOnce({
        id: CART_ID,
        items: [ITEM],
        updatedAt: NOW,
      })
      .mockResolvedValueOnce({
        id: CART_ID,
        items: [
          {
            ...ITEM,
            sku: { ...ITEM.sku, price: new Prisma.Decimal('13.00') },
          },
        ],
        updatedAt: NOW,
      });

    const first = await service.getOrCreate(CLIENT);
    const second = await service.getOrCreate(CLIENT);

    expect(first).toEqual({
      id: CART_ID,
      items: [
        {
          id: ITEM_ID,
          skuId: SKU_ID,
          productId: PRODUCT_ID,
          productName: 'Classic Crew',
          skuCode: 'CREW-BLUE-M',
          size: 'M',
          color: 'Blue',
          quantity: 3,
          unitPrice: '12.50',
          lineTotal: '37.50',
        },
      ],
      subtotalAmount: '37.50',
      currency: 'USD',
      updatedAt: NOW.toISOString(),
    });
    expect(second).toEqual({
      ...first,
      items: [
        {
          ...first.items[0],
          unitPrice: '13.00',
          lineTotal: '39.00',
        },
      ],
      subtotalAmount: '39.00',
    });
    expect(cartUpsert).toHaveBeenCalledTimes(2);
  });

  it('adds every line total to the cart subtotal', async () => {
    cartFindUniqueOrThrow.mockResolvedValue({
      id: CART_ID,
      items: [ITEM, SECOND_ITEM],
      updatedAt: NOW,
    });

    const response = await service.getOrCreate(CLIENT);

    expect(response.subtotalAmount).toBe('48.00');
    expect(response.items).toHaveLength(2);
  });

  it('treats a concurrent first access as success', async () => {
    cartUpsert.mockRejectedValue(prismaError('P2002'));

    await expect(service.getOrCreate(CLIENT)).resolves.toMatchObject({
      id: CART_ID,
      items: [],
    });
    expect(cartFindUniqueOrThrow).toHaveBeenNthCalledWith(1, {
      where: { clientId: CLIENT.id },
      select: { id: true },
    });
  });

  it('does not hide other cart-creation failures', async () => {
    const failure = new Error('database unavailable');
    cartUpsert.mockRejectedValue(failure);

    await expect(service.getOrCreate(CLIENT)).rejects.toBe(failure);
    expect(cartFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('adds an item before the first GET without reading or changing stock', async () => {
    itemCreate.mockResolvedValue({ ...ITEM, quantity: 20 });

    const response = await service.addItem(CLIENT, {
      skuId: SKU_ID,
      quantity: 20,
    });

    expect(skuFindFirst).toHaveBeenCalledWith({
      where: {
        id: SKU_ID,
        product: { isActive: true, deletedAt: null },
      },
      select: { id: true },
    });
    expect(cartUpsert).toHaveBeenCalledTimes(1);
    expect(itemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cartId: CART_ID, skuId: SKU_ID, quantity: 20 },
      }),
    );
    const [createInput] = itemCreate.mock.calls[0];
    expect(createInput).not.toHaveProperty('select.sku.select.stockQuantity');
    expect(response).toEqual({
      id: ITEM_ID,
      skuId: SKU_ID,
      productId: PRODUCT_ID,
      productName: 'Classic Crew',
      skuCode: 'CREW-BLUE-M',
      size: 'M',
      color: 'Blue',
      quantity: 20,
      unitPrice: '12.50',
      lineTotal: '250.00',
    });
  });

  it('refuses a SKU whose product is not visible', async () => {
    skuFindFirst.mockResolvedValue(null);

    await expect(
      service.addItem(CLIENT, { skuId: SKU_ID, quantity: 1 }),
    ).rejects.toThrow(NotFoundException);
    expect(cartUpsert).not.toHaveBeenCalled();
    expect(itemCreate).not.toHaveBeenCalled();
  });

  it('propagates a duplicate SKU constraint for the global 409 mapping', async () => {
    const duplicate = prismaError('P2002');
    itemCreate.mockRejectedValue(duplicate);

    await expect(
      service.addItem(CLIENT, { skuId: SKU_ID, quantity: 1 }),
    ).rejects.toBe(duplicate);
    expect(itemCreate).toHaveBeenCalledTimes(1);
    expect(itemUpdate).not.toHaveBeenCalled();
  });

  it('updates an owned item and computes its response from the current price', async () => {
    await expect(
      service.updateItem(CLIENT, ITEM_ID, { quantity: 3 }),
    ).resolves.toEqual({
      id: ITEM_ID,
      skuId: SKU_ID,
      productId: PRODUCT_ID,
      productName: 'Classic Crew',
      skuCode: 'CREW-BLUE-M',
      size: 'M',
      color: 'Blue',
      quantity: 3,
      unitPrice: '12.50',
      lineTotal: '37.50',
    });
    expect(itemFindFirst).toHaveBeenCalledWith({
      where: { id: ITEM_ID, cart: { clientId: CLIENT.id } },
      select: { id: true },
    });
    expect(itemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID },
        data: { quantity: 3 },
      }),
    );
  });

  it("hides another client's item on update", async () => {
    itemFindFirst.mockResolvedValue(null);

    await expect(
      service.updateItem(CLIENT, ITEM_ID, { quantity: 2 }),
    ).rejects.toThrow(NotFoundException);
    expect(itemUpdate).not.toHaveBeenCalled();
  });

  it('removes only an item owned by the client', async () => {
    await expect(service.removeItem(CLIENT, ITEM_ID)).resolves.toBeUndefined();
    expect(itemDeleteMany).toHaveBeenCalledWith({
      where: { id: ITEM_ID, cart: { clientId: CLIENT.id } },
    });
  });

  it("hides another client's item on removal", async () => {
    itemDeleteMany.mockResolvedValue({ count: 0 });

    await expect(service.removeItem(CLIENT, ITEM_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
