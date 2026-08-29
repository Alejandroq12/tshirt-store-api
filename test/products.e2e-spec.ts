import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import type { Product, User } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

import { ProductStatus } from '../src/products/products.dto';
import type {
  ProductDetailResponse,
  ProductPageResponse,
  ProductResponse,
} from '../src/products/products.service';
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

type FixtureStatus = 'active' | 'inactive' | 'retired';

interface ProductFixtureOptions {
  id?: string;
  name?: string;
  description?: string | null;
  status?: FixtureStatus;
  createdAt?: Date;
}

describe('Products (e2e)', () => {
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

  const createCategory = (slug = 't-shirts') =>
    prisma.category.create({
      data: { name: slug, slug },
    });

  const createProduct = async (
    categoryId: string,
    options: ProductFixtureOptions = {},
  ): Promise<Product> => {
    const id = options.id ?? randomUUID();
    const status = options.status ?? 'inactive';
    const createdAt = options.createdAt ?? new Date();

    return prisma.product.create({
      data: {
        id,
        categoryId,
        name: options.name ?? `Product ${id}`,
        description: options.description,
        isActive: status === 'active',
        deletedAt: status === 'retired' ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
        ...(status === 'active'
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

  const list = (query: string, token?: string) => {
    const operation = request(app.getHttpServer()).get(`/v1/products?${query}`);
    return token
      ? operation.set('Authorization', `Bearer ${token}`)
      : operation;
  };

  it('requires valid limit, offset, product IDs, and optional credentials', async () => {
    await request(app.getHttpServer()).get('/v1/products').expect(422);
    await list('limit=0&offset=-1&extra=value').expect(422);
    await request(app.getHttpServer())
      .get('/v1/products/not-a-uuid')
      .expect(422);
    await list('limit=10&offset=0', 'not-a-token').expect(401);
    await request(app.getHttpServer())
      .get(`/v1/products/${randomUUID()}`)
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);
  });

  it('filters by an exact category slug and orders before paginating', async () => {
    const category = await createCategory();
    const otherCategory = await createCategory('hoodies');
    const first = await createProduct(category.id, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      name: 'First',
      status: 'active',
      createdAt: new Date('2026-08-28T10:00:00.000Z'),
    });
    const second = await createProduct(category.id, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      name: 'Second',
      status: 'active',
      createdAt: new Date('2026-08-28T11:00:00.000Z'),
    });
    const third = await createProduct(category.id, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      name: 'Third',
      status: 'active',
      createdAt: new Date('2026-08-28T11:00:00.000Z'),
    });
    await createProduct(category.id, { status: 'inactive' });
    await createProduct(category.id, { status: 'retired' });
    await createProduct(otherCategory.id, { status: 'active' });

    const response = await list('limit=2&offset=1&category=t-shirts').expect(
      200,
    );
    const body = response.body as ProductPageResponse;

    expect(body.items.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(body.pagination).toEqual({ limit: 2, offset: 1, total: 3 });
    expect(body.items[0].primaryImageUrl).toBe(
      `https://cdn.example.com/${second.id}/primary.webp`,
    );
    expect(body.items.every(({ liked }) => liked === null)).toBe(true);

    const all = await list('limit=3&offset=0&category=t-shirts').expect(200);
    expect((all.body as ProductPageResponse).items.map(({ id }) => id)).toEqual(
      [third.id, second.id, first.id],
    );

    const unknown = await list('limit=10&offset=0&category=T-Shirts').expect(
      200,
    );
    expect(unknown.body).toEqual({
      items: [],
      pagination: { limit: 10, offset: 0, total: 0 },
    });
  });

  it('shows active products to everyone and every state only to managers', async () => {
    const category = await createCategory();
    const active = await createProduct(category.id, { status: 'active' });
    const inactive = await createProduct(category.id, { status: 'inactive' });
    const retired = await createProduct(category.id, { status: 'retired' });
    const client = await login('CLIENT');
    const manager = await login('MANAGER');
    await prisma.productLike.create({
      data: { clientId: client.user.id, productId: active.id },
    });

    const anonymous = await list('limit=10&offset=0').expect(200);
    const clientResponse = await list(
      'limit=10&offset=0',
      client.accessToken,
    ).expect(200);
    const managerResponse = await list(
      'limit=10&offset=0',
      manager.accessToken,
    ).expect(200);

    expect((anonymous.body as ProductPageResponse).items).toHaveLength(1);
    expect((anonymous.body as ProductPageResponse).items[0]).toMatchObject({
      id: active.id,
      status: ProductStatus.ACTIVE,
      liked: null,
    });
    expect((clientResponse.body as ProductPageResponse).items).toEqual([
      {
        ...(anonymous.body as ProductPageResponse).items[0],
        liked: true,
      },
    ]);

    const managerItems = (managerResponse.body as ProductPageResponse).items;
    expect(new Set(managerItems.map(({ id }) => id))).toEqual(
      new Set([active.id, inactive.id, retired.id]),
    );
    expect(new Set(managerItems.map(({ status }) => status))).toEqual(
      new Set([
        ProductStatus.ACTIVE,
        ProductStatus.INACTIVE,
        ProductStatus.RETIRED,
      ]),
    );
    expect(managerItems.every(({ liked }) => liked === null)).toBe(true);
  });

  it('returns product details once and resolves SKU-specific or fallback images', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id, {
      name: 'Classic Crew',
      description: 'Cotton shirt',
      status: 'active',
    });
    const fallback = await prisma.productImage.findFirstOrThrow({
      where: { productId: product.id, isFallback: true },
    });
    const firstSku = await prisma.productSku.create({
      data: {
        productId: product.id,
        skuCode: 'CREW-BLUE-M',
        size: 'M',
        color: 'Blue',
        price: '19.90',
        stockQuantity: 4,
      },
    });
    const secondSku = await prisma.productSku.create({
      data: {
        productId: product.id,
        skuCode: 'CREW-BLUE-L',
        size: 'L',
        color: 'Blue',
        price: '21.00',
        stockQuantity: 3,
      },
    });
    const skuImage = await prisma.productImage.create({
      data: {
        productId: product.id,
        url: 'https://cdn.example.com/sku-blue.webp',
        s3Key: `products/${product.id}/sku-blue.webp`,
        isFallback: false,
        isProductPrimary: false,
      },
    });
    await prisma.skuImageAssignment.create({
      data: {
        productId: product.id,
        skuId: firstSku.id,
        imageId: skuImage.id,
        isPrimary: true,
      },
    });

    const anonymous = await request(app.getHttpServer())
      .get(`/v1/products/${product.id}`)
      .expect(200);
    const body = anonymous.body as ProductDetailResponse;

    expect(body).toMatchObject({
      id: product.id,
      categoryId: category.id,
      name: 'Classic Crew',
      description: 'Cotton shirt',
      status: ProductStatus.ACTIVE,
      retiredAt: null,
      category: { id: category.id, name: 't-shirts', slug: 't-shirts' },
      fallbackImageIds: [fallback.id],
      primaryImageId: fallback.id,
      liked: null,
    });
    expect(body.imageAssets).toHaveLength(2);
    expect(body.imageAssets[0]).not.toHaveProperty('s3Key');
    expect(body.imageAssets.find(({ id }) => id === skuImage.id)).toMatchObject(
      {
        skuIds: [firstSku.id],
        primaryForSkuIds: [firstSku.id],
      },
    );
    expect(body.skus.find(({ id }) => id === firstSku.id)).toMatchObject({
      price: '19.90',
      currency: 'USD',
      imageIds: [skuImage.id],
      primaryImageId: skuImage.id,
      imageSource: 'sku',
    });
    expect(body.skus.find(({ id }) => id === secondSku.id)).toMatchObject({
      price: '21.00',
      currency: 'USD',
      imageIds: [fallback.id],
      primaryImageId: fallback.id,
      imageSource: 'product',
    });

    const client = await login('CLIENT');
    await prisma.productLike.create({
      data: { clientId: client.user.id, productId: product.id },
    });
    const clientResponse = await request(app.getHttpServer())
      .get(`/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${client.accessToken}`)
      .expect(200);
    expect((clientResponse.body as ProductDetailResponse).liked).toBe(true);
  });

  it('hides inactive and retired details from clients but not managers', async () => {
    const category = await createCategory();
    const inactive = await createProduct(category.id, { status: 'inactive' });
    const retired = await createProduct(category.id, { status: 'retired' });
    const client = await login('CLIENT');
    const manager = await login('MANAGER');

    await request(app.getHttpServer())
      .get(`/v1/products/${inactive.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/v1/products/${inactive.id}`)
      .set('Authorization', `Bearer ${client.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/v1/products/${retired.id}`)
      .expect(404);

    const inactiveResponse = await request(app.getHttpServer())
      .get(`/v1/products/${inactive.id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    const retiredResponse = await request(app.getHttpServer())
      .get(`/v1/products/${retired.id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);

    expect((inactiveResponse.body as ProductDetailResponse).status).toBe(
      ProductStatus.INACTIVE,
    );
    expect((retiredResponse.body as ProductDetailResponse).status).toBe(
      ProductStatus.RETIRED,
    );
  });

  it('allows only managers to create an inactive product', async () => {
    const category = await createCategory();
    const input = {
      categoryId: category.id,
      name: 'Essential Pocket T-Shirt',
      description: null,
    };

    await request(app.getHttpServer())
      .post('/v1/products')
      .send(input)
      .expect(401);

    const client = await login('CLIENT');
    await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${client.accessToken}`)
      .send(input)
      .expect(403);

    const manager = await login('MANAGER');
    const response = await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send(input)
      .expect(201);
    const body = response.body as ProductResponse;

    expect(Object.keys(body).sort()).toEqual([
      'categoryId',
      'createdAt',
      'description',
      'id',
      'name',
      'retiredAt',
      'status',
      'updatedAt',
    ]);
    expect(body).toMatchObject({
      categoryId: category.id,
      name: input.name,
      description: null,
      status: ProductStatus.INACTIVE,
      retiredAt: null,
    });
    expect(response.headers.location).toBe(`/v1/products/${body.id}`);
    expect(
      await prisma.product.findUniqueOrThrow({ where: { id: body.id } }),
    ).toMatchObject({ isActive: false, deletedAt: null });

    await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ ...input, categoryId: randomUUID() })
      .expect(404);
    await request(app.getHttpServer())
      .post('/v1/products')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ ...input, name: '', unexpected: true })
      .expect(422);
  });

  it('updates fields with contract validation and the same manager authorization', async () => {
    const category = await createCategory();
    const replacement = await createCategory('long-sleeves');
    const product = await createProduct(category.id);
    const client = await login('CLIENT');
    const manager = await login('MANAGER');
    const path = `/v1/products/${product.id}`;

    await request(app.getHttpServer())
      .patch(path)
      .send({ name: 'New' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${client.accessToken}`)
      .send({ name: 'New' })
      .expect(403);

    const response = await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({
        categoryId: replacement.id,
        name: 'Updated Product',
        description: null,
      })
      .expect(200);
    expect(response.body).toMatchObject({
      id: product.id,
      categoryId: replacement.id,
      name: 'Updated Product',
      description: null,
      status: ProductStatus.INACTIVE,
    });

    await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({})
      .expect(422);
    await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ status: 'deleted' })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/v1/products/${randomUUID()}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ name: 'Missing' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ categoryId: randomUUID() })
      .expect(404);
    await request(app.getHttpServer())
      .patch('/v1/products/not-a-uuid')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ name: 'Invalid path' })
      .expect(422);
  });

  it('requires a usable primary image, supports disable/reactivate, and makes retirement terminal', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const manager = await login('MANAGER');
    const path = `/v1/products/${product.id}`;
    const authorizedPatch = (body: object) =>
      request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send(body);

    await authorizedPatch({ status: ProductStatus.ACTIVE }).expect(409);

    await prisma.productImage.create({
      data: {
        productId: product.id,
        url: 'https://cdn.example.com/primary.webp',
        s3Key: `products/${product.id}/primary.webp`,
        isFallback: true,
        isProductPrimary: true,
      },
    });
    await authorizedPatch({ status: ProductStatus.ACTIVE })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ status: ProductStatus.ACTIVE });
      });
    await authorizedPatch({ status: ProductStatus.INACTIVE })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: ProductStatus.INACTIVE,
          retiredAt: null,
        });
      });
    await authorizedPatch({ status: ProductStatus.ACTIVE }).expect(200);

    const retired = await authorizedPatch({
      status: ProductStatus.RETIRED,
    }).expect(200);
    const retiredAt = (retired.body as ProductResponse).retiredAt;
    expect(retiredAt).not.toBeNull();

    const edited = await authorizedPatch({ name: 'Retained Product' }).expect(
      200,
    );
    expect(edited.body).toMatchObject({
      name: 'Retained Product',
      status: ProductStatus.RETIRED,
      retiredAt,
    });
    await authorizedPatch({ status: ProductStatus.INACTIVE }).expect(409);
    await authorizedPatch({ status: ProductStatus.ACTIVE }).expect(409);
    await request(app.getHttpServer())
      .delete(path)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(404);
    await expect(
      prisma.product.delete({ where: { id: product.id } }),
    ).rejects.toThrow(/cannot be physically deleted/i);
  });
});
