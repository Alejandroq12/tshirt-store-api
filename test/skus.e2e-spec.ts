import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Prisma, type Product, type User } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { SkuDetailResponse, SkuResponse } from '../src/skus/skus.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './support/create-test-app';
import { truncateAll } from './support/database';
import {
  createClient,
  createManager,
  KNOWN_PASSWORD,
} from './support/fixtures';

interface AuthSessionBody {
  accessToken: string;
}

type ProductState = 'active' | 'inactive' | 'retired';

describe('SKUs (e2e)', () => {
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

  const createCategory = () =>
    prisma.category.create({
      data: { name: 'T-Shirts', slug: 't-shirts' },
    });

  const createProduct = async (
    categoryId: string,
    state: ProductState = 'inactive',
  ): Promise<Product> => {
    const id = randomUUID();

    return prisma.product.create({
      data: {
        id,
        categoryId,
        name: `Product ${id}`,
        isActive: state === 'active',
        deletedAt: state === 'retired' ? new Date() : null,
        ...(state === 'active'
          ? {
              images: {
                create: {
                  url: `https://cdn.example.com/${id}/primary.webp`,
                  s3Key: `products/${id}/primary.webp`,
                  isFallback: true,
                  isProductPrimary: true,
                },
              },
            }
          : {}),
      },
    });
  };

  const createSku = (
    productId: string,
    overrides: Partial<{
      skuCode: string;
      size: string;
      color: string;
      price: string;
      stockQuantity: number;
    }> = {},
  ) =>
    prisma.productSku.create({
      data: {
        productId,
        skuCode: overrides.skuCode ?? `SKU-${randomUUID()}`,
        size: overrides.size ?? 'M',
        color: overrides.color ?? 'Blue',
        price: overrides.price ?? '19.90',
        stockQuantity: overrides.stockQuantity ?? 4,
      },
    });

  const login = async (
    role: 'MANAGER' | 'CLIENT',
  ): Promise<{ user: User; accessToken: string }> => {
    const user =
      role === 'MANAGER'
        ? await createManager(prisma)
        : await createClient(prisma);
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: user.email, password: KNOWN_PASSWORD })
      .expect(200);

    return {
      user,
      accessToken: (response.body as AuthSessionBody).accessToken,
    };
  };

  const createInput = (productId: string) => ({
    productId,
    skuCode: 'CREW-BLUE-M',
    size: 'M',
    color: 'Blue',
    price: '21.90',
    stockQuantity: 12,
  });

  it('allows only managers to create a SKU with a decimal string', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const input = createInput(product.id);

    await request(app.getHttpServer()).post('/v1/skus').send(input).expect(401);

    const client = await login('CLIENT');
    await request(app.getHttpServer())
      .post('/v1/skus')
      .set('Authorization', `Bearer ${client.accessToken}`)
      .send(input)
      .expect(403);

    const manager = await login('MANAGER');
    const response = await request(app.getHttpServer())
      .post('/v1/skus')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send(input)
      .expect(201);
    const body = response.body as SkuResponse;

    expect(Object.keys(body).sort()).toEqual([
      'color',
      'createdAt',
      'currency',
      'id',
      'price',
      'productId',
      'size',
      'skuCode',
      'stockQuantity',
      'updatedAt',
    ]);
    expect(body).toMatchObject({
      productId: product.id,
      skuCode: input.skuCode,
      size: input.size,
      color: input.color,
      price: '21.90',
      currency: 'USD',
      stockQuantity: 12,
    });
    expect(typeof body.price).toBe('string');
    expect(response.headers.location).toBe(`/v1/skus/${body.id}`);

    const stored = await prisma.productSku.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(stored.price).toBeInstanceOf(Prisma.Decimal);
    expect(stored.price.toFixed(2)).toBe('21.90');

    await request(app.getHttpServer())
      .post('/v1/skus')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ ...input, productId: randomUUID(), skuCode: 'MISSING-PRODUCT' })
      .expect(404);

    const invalidBodies = [
      { ...input, skuCode: 'NUMBER-PRICE', price: 21.9 },
      { ...input, skuCode: 'ONE-DECIMAL', price: '21.9' },
      { ...input, skuCode: 'ZERO-PRICE', price: '0.00' },
      { ...input, skuCode: 'NEGATIVE-STOCK', stockQuantity: -1 },
      { ...input, skuCode: 'HAS-STATUS', status: 'active' },
    ];

    for (const invalid of invalidBodies) {
      await request(app.getHttpServer())
        .post('/v1/skus')
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send(invalid)
        .expect(422);
    }
  });

  it('surfaces global code and per-product variant uniqueness as 409', async () => {
    const category = await createCategory();
    const firstProduct = await createProduct(category.id);
    const secondProduct = await createProduct(category.id);
    const manager = await login('MANAGER');
    const postSku = (body: object) =>
      request(app.getHttpServer())
        .post('/v1/skus')
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send(body);

    await postSku(createInput(firstProduct.id)).expect(201);

    const duplicateCode = await postSku({
      ...createInput(secondProduct.id),
      size: 'L',
      skuCode: 'CREW-BLUE-M',
    }).expect(409);
    const duplicateVariant = await postSku({
      ...createInput(firstProduct.id),
      skuCode: 'CREW-BLUE-M-SECOND',
    }).expect(409);

    expect(duplicateCode.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(duplicateVariant.headers['content-type']).toContain(
      'application/problem+json',
    );
    await postSku({
      ...createInput(secondProduct.id),
      skuCode: 'CREW-BLUE-M-OTHER-PRODUCT',
    }).expect(201);
  });

  it('inherits visibility from the product and exposes no SKU state', async () => {
    const category = await createCategory();
    const activeProduct = await createProduct(category.id, 'active');
    const inactiveProduct = await createProduct(category.id, 'inactive');
    const retiredProduct = await createProduct(category.id, 'retired');
    const activeSku = await createSku(activeProduct.id, {
      skuCode: 'ACTIVE-ZERO-STOCK',
      stockQuantity: 0,
    });
    const inactiveSku = await createSku(inactiveProduct.id, {
      skuCode: 'INACTIVE-SKU',
    });
    const retiredSku = await createSku(retiredProduct.id, {
      skuCode: 'RETIRED-SKU',
    });
    const client = await login('CLIENT');
    const manager = await login('MANAGER');

    const activeResponse = await request(app.getHttpServer())
      .get(`/v1/skus/${activeSku.id}`)
      .expect(200);
    const activeBody = activeResponse.body as SkuDetailResponse;
    expect(activeBody.stockQuantity).toBe(0);
    expect(typeof activeBody.price).toBe('string');
    expect(activeBody).not.toHaveProperty('status');
    expect(activeBody).not.toHaveProperty('purchasable');

    await request(app.getHttpServer())
      .get(`/v1/skus/${inactiveSku.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/v1/skus/${inactiveSku.id}`)
      .set('Authorization', `Bearer ${client.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/v1/skus/${retiredSku.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/v1/skus/${inactiveSku.id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/v1/skus/${retiredSku.id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/v1/skus/${activeSku.id}`)
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);
    await request(app.getHttpServer()).get('/v1/skus/not-a-uuid').expect(422);
    await request(app.getHttpServer())
      .get(`/v1/skus/${randomUUID()}`)
      .expect(404);
  });

  it('resolves SKU-specific images before product fallbacks', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id, 'active');
    const fallback = await prisma.productImage.findFirstOrThrow({
      where: { productId: product.id, isFallback: true },
    });
    const specificSku = await createSku(product.id, {
      skuCode: 'SPECIFIC-IMAGE',
    });
    const sharedSku = await createSku(product.id, {
      skuCode: 'SHARED-IMAGE',
      size: 'L',
    });
    const fallbackSku = await createSku(product.id, {
      skuCode: 'FALLBACK-IMAGE',
      size: 'S',
    });
    const image = await prisma.productImage.create({
      data: {
        productId: product.id,
        url: 'https://cdn.example.com/sku-blue.webp',
        s3Key: `products/${product.id}/sku-blue.webp`,
        isFallback: false,
        isProductPrimary: false,
      },
    });
    await prisma.skuImageAssignment.createMany({
      data: [
        {
          productId: product.id,
          skuId: specificSku.id,
          imageId: image.id,
          isPrimary: true,
        },
        {
          productId: product.id,
          skuId: sharedSku.id,
          imageId: image.id,
          isPrimary: true,
        },
      ],
    });

    const specificResponse = await request(app.getHttpServer())
      .get(`/v1/skus/${specificSku.id}`)
      .expect(200);
    const specific = specificResponse.body as SkuDetailResponse;
    expect(specific.images).toHaveLength(1);
    expect(specific.images[0]).toMatchObject({
      id: image.id,
      skuIds: [specificSku.id, sharedSku.id].sort(),
      primaryForSkuIds: [specificSku.id, sharedSku.id].sort(),
      isProductPrimary: false,
    });
    expect(specific.images[0]).not.toHaveProperty('s3Key');
    expect(specific.primaryImageId).toBe(image.id);
    expect(specific.imageSource).toBe('sku');

    const fallbackResponse = await request(app.getHttpServer())
      .get(`/v1/skus/${fallbackSku.id}`)
      .expect(200);
    const resolvedFallback = fallbackResponse.body as SkuDetailResponse;
    expect(resolvedFallback.images.map(({ id }) => id)).toEqual([fallback.id]);
    expect(resolvedFallback.primaryImageId).toBe(fallback.id);
    expect(resolvedFallback.imageSource).toBe('product');
  });

  it('rejects null for an optional but non-nullable SKU field', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const sku = await createSku(product.id);
    const manager = await login('MANAGER');

    const response = await request(app.getHttpServer())
      .patch(`/v1/skus/${sku.id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ price: null })
      .expect(422);

    expect(
      (response.body as { errors: Array<{ field: string }> }).errors.map(
        ({ field }) => field,
      ),
    ).toContain('price');
  });

  it('allows only managers to update fields and surfaces unique conflicts', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const first = await createSku(product.id, {
      skuCode: 'FIRST-SKU',
      size: 'M',
      color: 'Blue',
    });
    const second = await createSku(product.id, {
      skuCode: 'SECOND-SKU',
      size: 'L',
      color: 'Red',
    });
    const path = `/v1/skus/${first.id}`;

    await request(app.getHttpServer())
      .patch(path)
      .send({ stockQuantity: 8 })
      .expect(401);
    const client = await login('CLIENT');
    await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${client.accessToken}`)
      .send({ stockQuantity: 8 })
      .expect(403);

    const manager = await login('MANAGER');
    const patchSku = (body: object, skuId = first.id) =>
      request(app.getHttpServer())
        .patch(`/v1/skus/${skuId}`)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send(body);
    const response = await patchSku({
      skuCode: 'UPDATED-SKU',
      size: 'XL',
      color: 'Green',
      price: '25.00',
      stockQuantity: 0,
    }).expect(200);
    const body = response.body as SkuResponse;

    expect(body).toMatchObject({
      id: first.id,
      productId: product.id,
      skuCode: 'UPDATED-SKU',
      size: 'XL',
      color: 'Green',
      price: '25.00',
      currency: 'USD',
      stockQuantity: 0,
    });
    expect(body).not.toHaveProperty('status');
    await patchSku({ skuCode: second.skuCode }).expect(409);
    await patchSku({ size: second.size, color: second.color }).expect(409);
    await patchSku({}).expect(422);
    await patchSku({ status: 'inactive' }).expect(422);
    await patchSku({ productId: randomUUID() }).expect(422);
    await patchSku({ price: 25 }).expect(422);
    await patchSku({ stockQuantity: 1 }, randomUUID()).expect(404);
    await patchSku({ stockQuantity: 1 }, 'not-a-uuid').expect(422);

    await request(app.getHttpServer())
      .delete(path)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(404);
    await expect(
      prisma.productSku.findUnique({ where: { id: first.id } }),
    ).resolves.not.toBeNull();
  });
});
