import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { EnvironmentVariables } from '../config/env.validation';
import type { PrismaService } from '../prisma/prisma.service';
import { ProductStatus } from './products.dto';
import { ProductsService } from './products.service';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const CATEGORY = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'T-Shirts',
  slug: 't-shirts',
};
const PRODUCT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  categoryId: CATEGORY.id,
  name: 'Classic Crew',
  description: null,
  isActive: false,
  lowStockCycle: 0,
  deletedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};
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

describe('ProductsService', () => {
  const productFindMany = jest.fn();
  const productCount = jest.fn();
  const productFindFirst = jest.fn();
  const productFindUnique = jest.fn();
  const productFindUniqueOrThrow = jest.fn();
  const productCreate = jest.fn();
  const productUpdateMany = jest.fn();
  const categoryFindUnique = jest.fn();
  const likeFindMany = jest.fn();
  const likeFindFirst = jest.fn();
  const likeUpsert = jest.fn();
  const likeDeleteMany = jest.fn();
  const imageFindFirst = jest.fn();
  const transaction = jest.fn(async (operations: Array<Promise<unknown>>) =>
    Promise.all(operations),
  );
  const prisma = {
    product: {
      findMany: productFindMany,
      count: productCount,
      findFirst: productFindFirst,
      findUnique: productFindUnique,
      findUniqueOrThrow: productFindUniqueOrThrow,
      create: productCreate,
      updateMany: productUpdateMany,
    },
    category: { findUnique: categoryFindUnique },
    productLike: {
      findMany: likeFindMany,
      findFirst: likeFindFirst,
      upsert: likeUpsert,
      deleteMany: likeDeleteMany,
    },
    productImage: { findFirst: imageFindFirst },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new ProductsService(prisma, {
    get: () => 'USD',
  } as unknown as ConfigService<EnvironmentVariables, true>);

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    productFindMany.mockResolvedValue([]);
    productCount.mockResolvedValue(0);
    productFindFirst.mockResolvedValue(null);
    productFindUnique.mockResolvedValue(PRODUCT);
    productFindUniqueOrThrow.mockResolvedValue(PRODUCT);
    productCreate.mockResolvedValue(PRODUCT);
    productUpdateMany.mockResolvedValue({ count: 1 });
    categoryFindUnique.mockResolvedValue({ id: CATEGORY.id });
    likeFindMany.mockResolvedValue([]);
    likeFindFirst.mockResolvedValue(null);
    likeUpsert.mockResolvedValue({});
    likeDeleteMany.mockResolvedValue({ count: 1 });
    imageFindFirst.mockResolvedValue({ id: 'image-id' });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('lists only active products for anonymous callers in the required order', async () => {
    productFindMany.mockResolvedValue([
      {
        ...PRODUCT,
        isActive: true,
        category: CATEGORY,
        images: [{ url: 'https://cdn.example.com/primary.webp' }],
      },
    ]);
    productCount.mockResolvedValue(1);

    const response = await service.list({
      limit: 20,
      offset: 4,
      category: CATEGORY.slug,
    });

    expect(productFindMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        deletedAt: null,
        category: { slug: CATEGORY.slug },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 4,
      take: 20,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        images: {
          where: { isFallback: true, isProductPrimary: true },
          select: { url: true },
          take: 1,
        },
      },
    });
    expect(response).toEqual({
      items: [
        {
          id: PRODUCT.id,
          category: CATEGORY,
          name: PRODUCT.name,
          description: null,
          status: ProductStatus.ACTIVE,
          primaryImageUrl: 'https://cdn.example.com/primary.webp',
          liked: null,
        },
      ],
      pagination: { limit: 20, offset: 4, total: 1 },
    });
  });

  it('returns client-specific liked state without changing visibility', async () => {
    productFindMany.mockResolvedValue([
      { ...PRODUCT, isActive: true, category: CATEGORY, images: [] },
      {
        ...PRODUCT,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        isActive: true,
        category: CATEGORY,
        images: [],
      },
    ]);
    productCount.mockResolvedValue(2);
    likeFindMany.mockResolvedValue([{ productId: PRODUCT.id }]);

    const response = await service.list({ limit: 10, offset: 0 }, CLIENT);

    expect(likeFindMany).toHaveBeenCalledWith({
      where: {
        clientId: CLIENT.id,
        productId: {
          in: [PRODUCT.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
        },
      },
      select: { productId: true },
    });
    expect(response.items.map(({ liked }) => liked)).toEqual([true, false]);
  });

  it('does not filter product states or query likes for a manager', async () => {
    await service.list({ limit: 10, offset: 0 }, MANAGER);

    expect(productFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 10,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        images: {
          where: { isFallback: true, isProductPrimary: true },
          select: { url: true },
          take: 1,
        },
      },
    });
    expect(likeFindMany).not.toHaveBeenCalled();
  });

  it('creates a new product as inactive', async () => {
    const response = await service.create({
      categoryId: CATEGORY.id,
      name: PRODUCT.name,
      description: null,
    });

    expect(productCreate).toHaveBeenCalledWith({
      data: {
        categoryId: CATEGORY.id,
        name: PRODUCT.name,
        description: null,
      },
    });
    expect(response.status).toBe(ProductStatus.INACTIVE);
    expect(response.retiredAt).toBeNull();
  });

  it('rejects creation when the category does not exist', async () => {
    categoryFindUnique.mockResolvedValue(null);

    await expect(
      service.create({ categoryId: CATEGORY.id, name: PRODUCT.name }),
    ).rejects.toThrow(NotFoundException);
    expect(productCreate).not.toHaveBeenCalled();
  });

  it('returns product details with resolved SKU and fallback images', async () => {
    productFindFirst.mockResolvedValue({
      ...PRODUCT,
      isActive: true,
      category: CATEGORY,
      images: [
        {
          id: 'fallback-image',
          productId: PRODUCT.id,
          url: 'https://cdn.example.com/fallback.webp',
          s3Key: 'fallback.webp',
          isFallback: true,
          isProductPrimary: true,
          createdAt: NOW,
          skuAssignments: [],
        },
        {
          id: 'sku-image',
          productId: PRODUCT.id,
          url: 'https://cdn.example.com/sku.webp',
          s3Key: 'sku.webp',
          isFallback: false,
          isProductPrimary: false,
          createdAt: NOW,
          skuAssignments: [{ skuId: 'sku-one', isPrimary: true }],
        },
      ],
      skus: [
        {
          id: 'sku-one',
          productId: PRODUCT.id,
          skuCode: 'CREW-BLUE-M',
          size: 'M',
          color: 'Blue',
          price: new Prisma.Decimal('19.90'),
          stockQuantity: 4,
          createdAt: NOW,
          updatedAt: NOW,
          imageAssignments: [{ imageId: 'sku-image', isPrimary: true }],
        },
        {
          id: 'sku-two',
          productId: PRODUCT.id,
          skuCode: 'CREW-BLUE-L',
          size: 'L',
          color: 'Blue',
          price: new Prisma.Decimal('21.00'),
          stockQuantity: 3,
          createdAt: NOW,
          updatedAt: NOW,
          imageAssignments: [],
        },
      ],
    });
    likeFindFirst.mockResolvedValue({ clientId: CLIENT.id });

    const response = await service.get(PRODUCT.id, CLIENT);

    expect(response.primaryImageId).toBe('fallback-image');
    expect(response.fallbackImageIds).toEqual(['fallback-image']);
    expect(response.imageAssets).toEqual([
      {
        id: 'fallback-image',
        productId: PRODUCT.id,
        url: 'https://cdn.example.com/fallback.webp',
        skuIds: [],
        isProductPrimary: true,
        primaryForSkuIds: [],
        createdAt: NOW.toISOString(),
      },
      {
        id: 'sku-image',
        productId: PRODUCT.id,
        url: 'https://cdn.example.com/sku.webp',
        skuIds: ['sku-one'],
        isProductPrimary: false,
        primaryForSkuIds: ['sku-one'],
        createdAt: NOW.toISOString(),
      },
    ]);
    expect(response.skus).toEqual([
      {
        id: 'sku-one',
        productId: PRODUCT.id,
        skuCode: 'CREW-BLUE-M',
        size: 'M',
        color: 'Blue',
        price: '19.90',
        currency: 'USD',
        stockQuantity: 4,
        imageIds: ['sku-image'],
        primaryImageId: 'sku-image',
        imageSource: 'sku',
      },
      {
        id: 'sku-two',
        productId: PRODUCT.id,
        skuCode: 'CREW-BLUE-L',
        size: 'L',
        color: 'Blue',
        price: '21.00',
        currency: 'USD',
        stockQuantity: 3,
        imageIds: ['fallback-image'],
        primaryImageId: 'fallback-image',
        imageSource: 'product',
      },
    ]);
    expect(response.liked).toBe(true);
  });

  it('returns no image source when neither SKU nor fallback images exist', async () => {
    productFindFirst.mockResolvedValue({
      ...PRODUCT,
      isActive: true,
      category: CATEGORY,
      images: [],
      skus: [
        {
          id: 'sku-one',
          productId: PRODUCT.id,
          skuCode: 'CREW-BLUE-M',
          size: 'M',
          color: 'Blue',
          price: new Prisma.Decimal('19.99'),
          stockQuantity: 1,
          createdAt: NOW,
          updatedAt: NOW,
          imageAssignments: [],
        },
      ],
    });

    const response = await service.get(PRODUCT.id, MANAGER);

    expect(response.primaryImageId).toBeNull();
    expect(response.skus[0]).toMatchObject({
      imageIds: [],
      primaryImageId: null,
      imageSource: 'none',
    });
    expect(response.liked).toBeNull();
  });

  it('hides non-active and missing products with the same 404', async () => {
    await expect(service.get(PRODUCT.id)).rejects.toThrow(NotFoundException);
    const call = (
      productFindFirst.mock.calls as Array<
        [{ where: Record<string, unknown>; include: object }]
      >
    )[0][0];
    expect(call.where).toEqual({
      id: PRODUCT.id,
      isActive: true,
      deletedAt: null,
    });
    expect(call.include).toBeDefined();
  });

  it('rejects activation without a usable fallback primary image', async () => {
    imageFindFirst.mockResolvedValue(null);

    await expect(
      service.update(PRODUCT.id, { status: ProductStatus.ACTIVE }),
    ).rejects.toThrow(ConflictException);
    expect(productUpdateMany).not.toHaveBeenCalled();
  });

  it('activates a live product only when the usable image exists', async () => {
    productFindUniqueOrThrow.mockResolvedValue({
      ...PRODUCT,
      isActive: true,
    });

    const response = await service.update(PRODUCT.id, {
      status: ProductStatus.ACTIVE,
    });

    expect(imageFindFirst).toHaveBeenCalledWith({
      where: {
        productId: PRODUCT.id,
        isFallback: true,
        isProductPrimary: true,
        url: { not: '' },
        s3Key: { not: '' },
        skuAssignments: { none: {} },
      },
      select: { id: true },
    });
    expect(productUpdateMany).toHaveBeenCalledWith({
      where: { id: PRODUCT.id, deletedAt: null },
      data: {
        categoryId: undefined,
        name: undefined,
        description: undefined,
        isActive: true,
        deletedAt: null,
      },
    });
    expect(response.status).toBe(ProductStatus.ACTIVE);
  });

  it('disables and retires products through lifecycle updates', async () => {
    productFindUniqueOrThrow
      .mockResolvedValueOnce({ ...PRODUCT, isActive: false })
      .mockResolvedValueOnce({ ...PRODUCT, deletedAt: NOW });

    const inactive = await service.update(PRODUCT.id, {
      status: ProductStatus.INACTIVE,
    });
    const retired = await service.update(PRODUCT.id, {
      status: ProductStatus.RETIRED,
    });

    expect(inactive.status).toBe(ProductStatus.INACTIVE);
    expect(retired.status).toBe(ProductStatus.RETIRED);
    expect(retired.retiredAt).toBe(NOW.toISOString());
  });

  it('keeps retirement terminal while allowing field edits', async () => {
    const retired = { ...PRODUCT, isActive: false, deletedAt: NOW };
    productFindUnique.mockResolvedValue(retired);
    productFindUniqueOrThrow.mockResolvedValue({
      ...retired,
      name: 'Edited after retirement',
    });

    await expect(
      service.update(PRODUCT.id, { status: ProductStatus.INACTIVE }),
    ).rejects.toThrow(ConflictException);

    const response = await service.update(PRODUCT.id, {
      name: 'Edited after retirement',
    });
    expect(response.status).toBe(ProductStatus.RETIRED);
    expect(response.retiredAt).toBe(NOW.toISOString());
  });

  it('returns 404 for a missing product or replacement category', async () => {
    productFindUnique.mockResolvedValueOnce(null);
    await expect(
      service.update(PRODUCT.id, { name: 'Updated' }),
    ).rejects.toThrow(NotFoundException);

    categoryFindUnique.mockResolvedValue(null);
    await expect(
      service.update(PRODUCT.id, { categoryId: CATEGORY.id }),
    ).rejects.toThrow(NotFoundException);
  });

  it('turns a concurrent retirement into a conflict instead of reactivating it', async () => {
    productUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(PRODUCT.id, { status: ProductStatus.ACTIVE }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates the row when a client likes a visible product', async () => {
    productFindFirst.mockResolvedValue({ id: PRODUCT.id });

    await expect(
      service.setLiked(PRODUCT.id, { liked: true }, CLIENT),
    ).resolves.toEqual({ productId: PRODUCT.id, liked: true });
    expect(productFindFirst).toHaveBeenCalledWith({
      where: { id: PRODUCT.id, isActive: true, deletedAt: null },
      select: { id: true },
    });
    expect(likeUpsert).toHaveBeenCalledWith({
      where: {
        clientId_productId: {
          clientId: CLIENT.id,
          productId: PRODUCT.id,
        },
      },
      create: { clientId: CLIENT.id, productId: PRODUCT.id },
      update: {},
    });
  });

  it('uses the same upsert when a client likes a product twice', async () => {
    productFindFirst.mockResolvedValue({ id: PRODUCT.id });

    await service.setLiked(PRODUCT.id, { liked: true }, CLIENT);
    await service.setLiked(PRODUCT.id, { liked: true }, CLIENT);

    expect(likeUpsert).toHaveBeenCalledTimes(2);
    expect(likeUpsert.mock.calls[0]).toEqual(likeUpsert.mock.calls[1]);
  });

  it('removes the row when a client unlikes a product', async () => {
    productFindFirst.mockResolvedValue({ id: PRODUCT.id });

    await expect(
      service.setLiked(PRODUCT.id, { liked: false }, CLIENT),
    ).resolves.toEqual({ productId: PRODUCT.id, liked: false });
    expect(likeDeleteMany).toHaveBeenCalledWith({
      where: { clientId: CLIENT.id, productId: PRODUCT.id },
    });
  });

  it('succeeds when a client unlikes a product they never liked', async () => {
    productFindFirst.mockResolvedValue({ id: PRODUCT.id });
    likeDeleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.setLiked(PRODUCT.id, { liked: false }, CLIENT),
    ).resolves.toEqual({ productId: PRODUCT.id, liked: false });
  });

  it('treats a concurrent duplicate like as success', async () => {
    productFindFirst.mockResolvedValue({ id: PRODUCT.id });
    likeUpsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );

    await expect(
      service.setLiked(PRODUCT.id, { liked: true }, CLIENT),
    ).resolves.toEqual({ productId: PRODUCT.id, liked: true });
  });

  it('does not hide other database failures while liking', async () => {
    const failure = new Error('database unavailable');
    productFindFirst.mockResolvedValue({ id: PRODUCT.id });
    likeUpsert.mockRejectedValue(failure);

    await expect(
      service.setLiked(PRODUCT.id, { liked: true }, CLIENT),
    ).rejects.toBe(failure);
  });

  it('refuses a product the client cannot see', async () => {
    await expect(
      service.setLiked(PRODUCT.id, { liked: true }, CLIENT),
    ).rejects.toThrow(NotFoundException);
    expect(productFindFirst).toHaveBeenCalledWith({
      where: { id: PRODUCT.id, isActive: true, deletedAt: null },
      select: { id: true },
    });
    expect(likeUpsert).not.toHaveBeenCalled();
  });

  it('checks visibility before unliking, not only before liking', async () => {
    await expect(
      service.setLiked(PRODUCT.id, { liked: false }, CLIENT),
    ).rejects.toThrow(NotFoundException);
    expect(likeDeleteMany).not.toHaveBeenCalled();
  });
});
