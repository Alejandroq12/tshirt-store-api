import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { EnvironmentVariables } from '../config/env.validation';
import type { StockCycleService } from '../notifications/stock-cycle.service';
import type { StockNotificationProducer } from '../notifications/stock-notification.producer';
import type { PrismaService } from '../prisma/prisma.service';
import { SkusService } from './skus.service';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const SKU = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  skuCode: 'CREW-BLUE-M',
  size: 'M',
  color: 'Blue',
  price: new Prisma.Decimal('19.90'),
  stockQuantity: 4,
  createdAt: NOW,
  updatedAt: NOW,
};
const MANAGER: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'MANAGER',
  sessionId: '22222222-2222-4222-8222-222222222222',
};

describe('SkusService', () => {
  const productFindUnique = jest.fn();
  const skuCreate = jest.fn();
  const skuFindFirst = jest.fn();
  const skuFindUnique = jest.fn();
  const skuUpdate = jest.fn();
  const queryRaw = jest.fn();
  const transaction = jest.fn();
  const totalStock = jest.fn();
  const evaluateStockCycle = jest.fn();
  const enqueueNotifications = jest.fn();
  const transactionClient = {
    productSku: { findUnique: skuFindUnique, update: skuUpdate },
    $queryRaw: queryRaw,
  };
  const prisma = {
    product: { findUnique: productFindUnique },
    productSku: {
      create: skuCreate,
      findFirst: skuFindFirst,
    },
    $transaction: transaction,
  } as unknown as PrismaService;
  const stockCycle = {
    totalStock,
    evaluate: evaluateStockCycle,
  } as unknown as StockCycleService;
  const notifications = {
    enqueue: enqueueNotifications,
  } as unknown as StockNotificationProducer;
  const service = new SkusService(prisma, stockCycle, notifications, {
    get: () => 'USD',
  } as unknown as ConfigService<EnvironmentVariables, true>);

  beforeEach(() => {
    jest.clearAllMocks();
    productFindUnique.mockResolvedValue({ id: SKU.productId });
    skuCreate.mockResolvedValue(SKU);
    skuFindFirst.mockResolvedValue(null);
    skuFindUnique.mockResolvedValue({ productId: SKU.productId });
    skuUpdate.mockResolvedValue(SKU);
    queryRaw.mockResolvedValue([]);
    transaction.mockImplementation(
      (work: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        work(transactionClient as unknown as Prisma.TransactionClient),
    );
    totalStock.mockResolvedValue(4);
    evaluateStockCycle.mockResolvedValue([]);
    enqueueNotifications.mockResolvedValue(undefined);
  });

  it('creates a SKU without converting its decimal string to a number', async () => {
    const input = {
      productId: SKU.productId,
      skuCode: SKU.skuCode,
      size: SKU.size,
      color: SKU.color,
      price: '19.90',
      stockQuantity: 4,
    };

    const response = await service.create(input);

    expect(skuCreate).toHaveBeenCalledWith({ data: input });
    expect(response).toEqual({
      id: SKU.id,
      productId: SKU.productId,
      skuCode: SKU.skuCode,
      size: SKU.size,
      color: SKU.color,
      price: '19.90',
      currency: 'USD',
      stockQuantity: 4,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it('rejects creation when the product does not exist', async () => {
    productFindUnique.mockResolvedValue(null);

    await expect(
      service.create({
        productId: SKU.productId,
        skuCode: SKU.skuCode,
        size: SKU.size,
        color: SKU.color,
        price: '19.90',
        stockQuantity: 4,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(skuCreate).not.toHaveBeenCalled();
  });

  it('resolves product fallback images for an anonymous caller', async () => {
    skuFindFirst.mockResolvedValue({
      ...SKU,
      product: {
        images: [
          {
            id: 'fallback-image',
            productId: SKU.productId,
            url: 'https://cdn.example.com/fallback.webp',
            s3Key: 'fallback.webp',
            isFallback: true,
            isProductPrimary: true,
            createdAt: NOW,
            skuAssignments: [],
          },
        ],
      },
      imageAssignments: [],
    });

    const response = await service.get(SKU.id);

    const call = (
      skuFindFirst.mock.calls as Array<
        [{ where: Record<string, unknown>; include: object }]
      >
    )[0][0];
    expect(call.where).toEqual({
      id: SKU.id,
      product: { isActive: true, deletedAt: null },
    });
    expect(response.images).toEqual([
      {
        id: 'fallback-image',
        productId: SKU.productId,
        url: 'https://cdn.example.com/fallback.webp',
        skuIds: [],
        isProductPrimary: true,
        primaryForSkuIds: [],
        createdAt: NOW.toISOString(),
      },
    ]);
    expect(response.primaryImageId).toBe('fallback-image');
    expect(response.imageSource).toBe('product');
  });

  it('resolves SKU-specific images and exposes all their assignments', async () => {
    const image = {
      id: 'sku-image',
      productId: SKU.productId,
      url: 'https://cdn.example.com/sku.webp',
      s3Key: 'sku.webp',
      isFallback: false,
      isProductPrimary: false,
      createdAt: NOW,
      skuAssignments: [
        { skuId: SKU.id, isPrimary: true },
        { skuId: 'other-sku', isPrimary: false },
      ],
    };
    skuFindFirst.mockResolvedValue({
      ...SKU,
      product: { images: [] },
      imageAssignments: [{ imageId: image.id, isPrimary: true, image }],
    });

    const response = await service.get(SKU.id, MANAGER);

    const call = (
      skuFindFirst.mock.calls as Array<
        [{ where: Record<string, unknown>; include: object }]
      >
    )[0][0];
    expect(call.where).toEqual({ id: SKU.id });
    expect(response.images[0]).toEqual({
      id: image.id,
      productId: SKU.productId,
      url: image.url,
      skuIds: [SKU.id, 'other-sku'],
      isProductPrimary: false,
      primaryForSkuIds: [SKU.id],
      createdAt: NOW.toISOString(),
    });
    expect(response.primaryImageId).toBe(image.id);
    expect(response.imageSource).toBe('sku');
  });

  it('returns no image source when no images are available', async () => {
    skuFindFirst.mockResolvedValue({
      ...SKU,
      product: { images: [] },
      imageAssignments: [],
    });

    const response = await service.get(SKU.id, MANAGER);

    expect(response.images).toEqual([]);
    expect(response.primaryImageId).toBeNull();
    expect(response.imageSource).toBe('none');
  });

  it('hides missing or non-visible SKUs behind the same 404', async () => {
    await expect(service.get(SKU.id)).rejects.toThrow(NotFoundException);
  });

  it('updates only mutable SKU fields and preserves decimal strings', async () => {
    skuUpdate.mockResolvedValue({
      ...SKU,
      skuCode: 'CREW-GREEN-L',
      size: 'L',
      color: 'Green',
      price: new Prisma.Decimal('21.00'),
      stockQuantity: 0,
    });
    const input = {
      skuCode: 'CREW-GREEN-L',
      size: 'L',
      color: 'Green',
      price: '21.00',
      stockQuantity: 0,
    };

    const response = await service.update(SKU.id, input);

    expect(skuUpdate).toHaveBeenCalledWith({
      where: { id: SKU.id },
      data: input,
    });
    expect(response).toMatchObject({
      skuCode: input.skuCode,
      size: input.size,
      color: input.color,
      price: '21.00',
      stockQuantity: 0,
    });
    expect(response).not.toHaveProperty('status');
  });

  it('locks the product and evaluates the aggregate stock change in one transaction', async () => {
    totalStock.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    evaluateStockCycle.mockResolvedValue(['notification-id']);

    await service.update(SKU.id, { stockQuantity: 2 });

    expect(skuFindUnique).toHaveBeenCalledWith({
      where: { id: SKU.id },
      select: { productId: true },
    });
    const [lock] = queryRaw.mock.calls[0] as [Prisma.Sql];
    expect(lock.strings.join('')).toContain(
      'SELECT id FROM products WHERE id = ',
    );
    expect(lock.strings.join('')).toContain('FOR UPDATE');
    expect(lock.values).toEqual([SKU.productId]);
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      skuUpdate.mock.invocationCallOrder[0],
    );
    expect(evaluateStockCycle).toHaveBeenCalledWith(
      transactionClient,
      SKU.productId,
      5,
      2,
    );
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueNotifications.mock.invocationCallOrder[0],
    );
    expect(enqueueNotifications).toHaveBeenCalledWith(['notification-id']);
  });

  it('keeps an unknown SKU as 404 without evaluating a cycle', async () => {
    skuFindUnique.mockResolvedValue(null);

    await expect(service.update(SKU.id, { stockQuantity: 2 })).rejects.toThrow(
      NotFoundException,
    );
    expect(queryRaw).not.toHaveBeenCalled();
    expect(skuUpdate).not.toHaveBeenCalled();
    expect(evaluateStockCycle).not.toHaveBeenCalled();
    expect(enqueueNotifications).not.toHaveBeenCalled();
  });
});
