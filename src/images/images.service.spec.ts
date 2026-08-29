import { NotFoundException } from '@nestjs/common';
import type { ProductImage } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import type { S3StorageService } from '../storage/s3-storage.service';
import { ImagesService } from './images.service';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FIRST_SKU_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const SECOND_SKU_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const STORED = {
  key: `products/${PRODUCT_ID}/image.webp`,
  url: 'https://cdn.example.com/image.webp',
};

describe('ImagesService', () => {
  const productFindUnique = jest.fn();
  const skuCount = jest.fn();
  const imageFindFirst = jest.fn();
  const imageUpdateMany = jest.fn();
  const imageCreate = jest.fn();
  const assignmentFindMany = jest.fn();
  const assignmentUpdateMany = jest.fn();
  const transactionClient = {
    productImage: {
      findFirst: imageFindFirst,
      updateMany: imageUpdateMany,
      create: imageCreate,
    },
    skuImageAssignment: {
      findMany: assignmentFindMany,
      updateMany: assignmentUpdateMany,
    },
  };
  const transaction = jest.fn(
    (callback: (client: typeof transactionClient) => unknown) =>
      Promise.resolve(callback(transactionClient)),
  );
  const prisma = {
    product: { findUnique: productFindUnique },
    productSku: { count: skuCount },
    $transaction: transaction,
  } as unknown as PrismaService;
  const storageUpload = jest.fn();
  const storageRemove = jest.fn();
  const storage = {
    upload: storageUpload,
    remove: storageRemove,
  } as unknown as S3StorageService;
  const service = new ImagesService(prisma, storage);

  beforeEach(() => {
    jest.clearAllMocks();
    productFindUnique.mockResolvedValue({ id: PRODUCT_ID });
    skuCount.mockResolvedValue(2);
    imageFindFirst.mockResolvedValue(null);
    imageUpdateMany.mockResolvedValue({ count: 1 });
    assignmentFindMany.mockResolvedValue([]);
    assignmentUpdateMany.mockResolvedValue({ count: 1 });
    storageUpload.mockResolvedValue(STORED);
    storageRemove.mockResolvedValue(undefined);
    imageCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          productId: data.productId,
          url: data.url,
          s3Key: data.s3Key,
          isFallback: data.isFallback,
          isProductPrimary: data.isProductPrimary,
          createdAt: NOW,
        } as ProductImage),
    );
  });

  it('does not upload when the product is missing', async () => {
    productFindUnique.mockResolvedValue(null);

    await expect(
      service.upload(
        PRODUCT_ID,
        {},
        {
          body: Buffer.from('image'),
          contentType: 'image/png',
        },
      ),
    ).rejects.toThrow(NotFoundException);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('does not upload when any supplied SKU belongs elsewhere', async () => {
    skuCount.mockResolvedValue(1);

    await expect(
      service.upload(
        PRODUCT_ID,
        { skuIds: [FIRST_SKU_ID, SECOND_SKU_ID] },
        { body: Buffer.from('image'), contentType: 'image/png' },
      ),
    ).rejects.toThrow(NotFoundException);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('creates the first fallback image as the product primary', async () => {
    const response = await service.upload(
      PRODUCT_ID,
      {},
      { body: Buffer.from('image'), contentType: 'image/webp' },
    );

    expect(storageUpload).toHaveBeenCalledWith({
      body: Buffer.from('image'),
      contentType: 'image/webp',
      prefix: `products/${PRODUCT_ID}`,
    });
    expect(imageCreate).toHaveBeenCalledWith({
      data: {
        productId: PRODUCT_ID,
        url: STORED.url,
        s3Key: STORED.key,
        isFallback: true,
        isProductPrimary: true,
      },
    });
    expect(response).toEqual({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      productId: PRODUCT_ID,
      url: STORED.url,
      skuIds: [],
      isProductPrimary: true,
      primaryForSkuIds: [],
      createdAt: NOW.toISOString(),
    });
  });

  it('keeps a later fallback non-primary unless replacement is requested', async () => {
    imageFindFirst.mockResolvedValue({ id: 'current-primary' });

    const response = await service.upload(
      PRODUCT_ID,
      {},
      { body: Buffer.from('image'), contentType: 'image/png' },
    );

    expect(response.isProductPrimary).toBe(false);
    expect(imageUpdateMany).not.toHaveBeenCalled();
  });

  it('replaces the current fallback primary when requested', async () => {
    const response = await service.upload(
      PRODUCT_ID,
      { primary: true },
      { body: Buffer.from('image'), contentType: 'image/png' },
    );

    expect(imageFindFirst).not.toHaveBeenCalled();
    expect(imageUpdateMany).toHaveBeenCalledWith({
      where: {
        productId: PRODUCT_ID,
        isFallback: true,
        isProductPrimary: true,
      },
      data: { isProductPrimary: false },
    });
    expect(response.isProductPrimary).toBe(true);
  });

  it('creates only variant assignments and fills missing SKU primaries', async () => {
    assignmentFindMany.mockResolvedValue([{ skuId: FIRST_SKU_ID }]);

    const response = await service.upload(
      PRODUCT_ID,
      { skuIds: [FIRST_SKU_ID, SECOND_SKU_ID] },
      { body: Buffer.from('image'), contentType: 'image/jpeg' },
    );

    expect(imageCreate).toHaveBeenCalledWith({
      data: {
        productId: PRODUCT_ID,
        url: STORED.url,
        s3Key: STORED.key,
        isFallback: false,
        isProductPrimary: false,
        skuAssignments: {
          create: [
            { skuId: FIRST_SKU_ID, isPrimary: false },
            { skuId: SECOND_SKU_ID, isPrimary: true },
          ],
        },
      },
    });
    expect(response).toMatchObject({
      skuIds: [FIRST_SKU_ID, SECOND_SKU_ID],
      isProductPrimary: false,
      primaryForSkuIds: [SECOND_SKU_ID],
    });
  });

  it('replaces the primary assignment for every supplied SKU', async () => {
    const response = await service.upload(
      PRODUCT_ID,
      { skuIds: [FIRST_SKU_ID, SECOND_SKU_ID], primary: true },
      { body: Buffer.from('image'), contentType: 'image/png' },
    );

    expect(assignmentFindMany).not.toHaveBeenCalled();
    expect(assignmentUpdateMany).toHaveBeenCalledWith({
      where: {
        skuId: { in: [FIRST_SKU_ID, SECOND_SKU_ID] },
        isPrimary: true,
      },
      data: { isPrimary: false },
    });
    expect(response.primaryForSkuIds).toEqual([FIRST_SKU_ID, SECOND_SKU_ID]);
  });

  it('removes the uploaded object when database persistence fails', async () => {
    const failure = new Error('database failed');
    transaction.mockRejectedValueOnce(failure);

    await expect(
      service.upload(
        PRODUCT_ID,
        {},
        {
          body: Buffer.from('image'),
          contentType: 'image/png',
        },
      ),
    ).rejects.toBe(failure);
    expect(storageRemove).toHaveBeenCalledWith(STORED.key);
  });
});
