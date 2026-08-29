import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import type { Product, ProductSku, User } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { ImageAssetResponse } from '../src/images/images.service';
import type { ProductDetailResponse } from '../src/products/products.service';
import { ProductStatus } from '../src/products/products.dto';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
} from '../src/storage/image-upload.constants';
import type { S3StorageService } from '../src/storage/s3-storage.service';
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

interface ValidationBody {
  errors: Array<{ field: string; message: string }>;
}

describe('Product images (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let objectSequence = 0;
  const storageUpload = jest.fn<
    ReturnType<S3StorageService['upload']>,
    Parameters<S3StorageService['upload']>
  >();
  const storageRemove = jest.fn<
    ReturnType<S3StorageService['remove']>,
    Parameters<S3StorageService['remove']>
  >();

  beforeAll(async () => {
    app = (await createTestApp({
      storage: { upload: storageUpload, remove: storageRemove },
    })) as INestApplication<App>;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    objectSequence = 0;
    storageUpload.mockReset().mockImplementation((input) => {
      const key = `${input.prefix}/image-${(objectSequence += 1)}.${IMAGE_CONTENT_TYPES[input.contentType]}`;
      return Promise.resolve({ key, url: `https://cdn.example.com/${key}` });
    });
    storageRemove.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  const createProduct = async (): Promise<Product> => {
    const category = await prisma.category.upsert({
      where: { slug: 't-shirts' },
      update: {},
      create: { name: 'T-Shirts', slug: 't-shirts' },
    });

    return prisma.product.create({
      data: { categoryId: category.id, name: `Product ${randomUUID()}` },
    });
  };

  const createSku = (productId: string, size: string): Promise<ProductSku> =>
    prisma.productSku.create({
      data: {
        productId,
        skuCode: `SKU-${randomUUID()}`,
        size,
        color: 'Blue',
        price: '19.99',
        stockQuantity: 5,
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

  it('allows only managers and exposes the uploaded fallback publicly', async () => {
    const product = await createProduct();

    await request(app.getHttpServer())
      .post(`/v1/products/${product.id}/images`)
      .attach('file', Buffer.from('png'), {
        filename: 'shirt.png',
        contentType: 'image/png',
      })
      .expect(401);

    const client = await login('CLIENT');
    await request(app.getHttpServer())
      .post(`/v1/products/${product.id}/images`)
      .set('Authorization', `Bearer ${client.accessToken}`)
      .attach('file', Buffer.from('png'), {
        filename: 'shirt.png',
        contentType: 'image/png',
      })
      .expect(403);

    const manager = await login('MANAGER');
    const response = await request(app.getHttpServer())
      .post(`/v1/products/${product.id}/images`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .attach('file', Buffer.from('png'), {
        filename: 'shirt.png',
        contentType: 'image/png',
      })
      .expect(201);
    const image = response.body as ImageAssetResponse;

    expect(Object.keys(image).sort()).toEqual([
      'createdAt',
      'id',
      'isProductPrimary',
      'primaryForSkuIds',
      'productId',
      'skuIds',
      'url',
    ]);
    expect(image).toMatchObject({
      productId: product.id,
      skuIds: [],
      isProductPrimary: true,
      primaryForSkuIds: [],
    });
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(storageUpload).toHaveBeenCalledWith({
      body: Buffer.from('png'),
      contentType: 'image/png',
      prefix: `products/${product.id}`,
    });

    const stored = await prisma.productImage.findUniqueOrThrow({
      where: { id: image.id },
      include: { skuAssignments: true },
    });
    expect(stored).toMatchObject({
      productId: product.id,
      isFallback: true,
      isProductPrimary: true,
    });
    expect(stored.skuAssignments).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ status: ProductStatus.ACTIVE })
      .expect(200);
    const publicResponse = await request(app.getHttpServer())
      .get(`/v1/products/${product.id}`)
      .expect(200);
    expect(
      (publicResponse.body as ProductDetailResponse).imageAssets,
    ).toContainEqual(image);
  });

  it('accepts all supported types and maintains one fallback primary', async () => {
    const product = await createProduct();
    const manager = await login('MANAGER');
    const upload = (contentType: 'image/jpeg' | 'image/png' | 'image/webp') =>
      request(app.getHttpServer())
        .post(`/v1/products/${product.id}/images`)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .attach('file', Buffer.from(contentType), {
          filename: `shirt.${IMAGE_CONTENT_TYPES[contentType]}`,
          contentType,
        });

    const first = (await upload('image/jpeg').expect(201))
      .body as ImageAssetResponse;
    const second = (await upload('image/png').expect(201))
      .body as ImageAssetResponse;
    const replacement = (
      await upload('image/webp').field('primary', 'true').expect(201)
    ).body as ImageAssetResponse;

    expect(first.isProductPrimary).toBe(true);
    expect(second.isProductPrimary).toBe(false);
    expect(replacement.isProductPrimary).toBe(true);
    expect(
      await prisma.productImage.count({
        where: {
          productId: product.id,
          isFallback: true,
          isProductPrimary: true,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.productImage.findUniqueOrThrow({
        where: { id: replacement.id },
      }),
    ).toMatchObject({ isFallback: true, isProductPrimary: true });
    expect(
      storageUpload.mock.calls.map(([input]) => input.contentType),
    ).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('creates only product-owned SKU assignments and one primary per SKU', async () => {
    const product = await createProduct();
    const otherProduct = await createProduct();
    const firstSku = await createSku(product.id, 'S');
    const secondSku = await createSku(product.id, 'M');
    const foreignSku = await createSku(otherProduct.id, 'L');
    const manager = await login('MANAGER');
    const uploadFor = (skuIds: string[], primary = false) => {
      let upload = request(app.getHttpServer())
        .post(`/v1/products/${product.id}/images`)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .attach('file', Buffer.from('image'), {
          filename: 'shirt.webp',
          contentType: 'image/webp',
        });

      for (const skuId of skuIds) upload = upload.field('skuIds', skuId);
      if (primary) upload = upload.field('primary', 'true');
      return upload;
    };

    await uploadFor([firstSku.id, foreignSku.id]).expect(404);
    expect(storageUpload).not.toHaveBeenCalled();

    const first = (await uploadFor([firstSku.id, secondSku.id]).expect(201))
      .body as ImageAssetResponse;
    const later = (await uploadFor([firstSku.id, secondSku.id]).expect(201))
      .body as ImageAssetResponse;
    const replacement = (
      await uploadFor([firstSku.id, secondSku.id], true).expect(201)
    ).body as ImageAssetResponse;

    expect(first).toMatchObject({
      skuIds: [firstSku.id, secondSku.id],
      isProductPrimary: false,
      primaryForSkuIds: [firstSku.id, secondSku.id],
    });
    expect(later.primaryForSkuIds).toEqual([]);
    expect(replacement.primaryForSkuIds).toEqual([firstSku.id, secondSku.id]);

    const images = await prisma.productImage.findMany({
      where: { productId: product.id },
      include: { skuAssignments: true },
    });
    expect(images).toHaveLength(3);
    expect(
      images.every(
        ({ isFallback, isProductPrimary, skuAssignments }) =>
          !isFallback && !isProductPrimary && skuAssignments.length === 2,
      ),
    ).toBe(true);
    expect(
      await prisma.skuImageAssignment.findMany({
        where: {
          skuId: { in: [firstSku.id, secondSku.id] },
          isPrimary: true,
        },
        select: { skuId: true, imageId: true },
        orderBy: { skuId: 'asc' },
      }),
    ).toEqual(
      [firstSku.id, secondSku.id]
        .sort()
        .map((skuId) => ({ skuId, imageId: replacement.id })),
    );
  });

  it('returns the required validation and file errors', async () => {
    const product = await createProduct();
    const sku = await createSku(product.id, 'M');
    const manager = await login('MANAGER');
    const authorize = (path: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${manager.accessToken}`);
    const attach = (path: string, size: number, contentType: string) =>
      authorize(path).attach('file', Buffer.alloc(size, 1), {
        filename: 'shirt.bin',
        contentType,
      });

    const missingFile = await authorize(`/v1/products/${product.id}/images`)
      .field('primary', 'false')
      .expect(422);
    expect((missingFile.body as ValidationBody).errors).toContainEqual({
      field: 'file',
      message: 'file is required',
    });

    await attach(`/v1/products/${product.id}/images`, 4, 'image/gif').expect(
      415,
    );
    await attach(
      `/v1/products/${product.id}/images`,
      IMAGE_MAX_BYTES + 1,
      'image/png',
    ).expect(413);
    await attach(
      `/v1/products/${product.id}/images`,
      IMAGE_MAX_BYTES,
      'image/jpeg',
    ).expect(201);

    await attach(`/v1/products/${product.id}/images`, 4, 'image/png')
      .field('primary', 'TRUE')
      .expect(422);
    await attach(`/v1/products/${product.id}/images`, 4, 'image/png')
      .field('skuIds', sku.id)
      .field('skuIds', sku.id)
      .expect(422);
    await attach('/v1/products/not-a-uuid/images', 4, 'image/png').expect(422);
    await attach(`/v1/products/${randomUUID()}/images`, 4, 'image/png').expect(
      404,
    );
  });
});
