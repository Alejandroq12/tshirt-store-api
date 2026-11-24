import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import type { Product, ProductSku, User } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { ImageAssetResponse } from '../src/images/types/images.types';
import type { ProductDetailResponse } from '../src/products/types/products.types';
import { ProductStatus } from '../src/products/products.dto';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
  type ImageContentType,
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

// An upload is checked against the leading bytes of its declared type, so the
// type's signature padded with filler stands for a real image.
const SIGNATURES: Readonly<Record<ImageContentType, Buffer>> = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
  ]),
};

const imageBytes = (contentType: ImageContentType, size = 16): Buffer => {
  const bytes = Buffer.alloc(size, 1);
  SIGNATURES[contentType].copy(bytes);
  return bytes;
};

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
    const png = imageBytes('image/png');

    await request(app.getHttpServer())
      .post(`/v1/products/${product.id}/images`)
      .attach('file', png, {
        filename: 'shirt.png',
        contentType: 'image/png',
      })
      .expect(401);

    const client = await login('CLIENT');
    await request(app.getHttpServer())
      .post(`/v1/products/${product.id}/images`)
      .set('Authorization', `Bearer ${client.accessToken}`)
      .attach('file', png, {
        filename: 'shirt.png',
        contentType: 'image/png',
      })
      .expect(403);

    const manager = await login('MANAGER');
    const response = await request(app.getHttpServer())
      .post(`/v1/products/${product.id}/images`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .attach('file', png, {
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
      body: png,
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
    const upload = (contentType: ImageContentType) =>
      request(app.getHttpServer())
        .post(`/v1/products/${product.id}/images`)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .attach('file', imageBytes(contentType), {
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
        .attach('file', imageBytes('image/webp'), {
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
    const attach = (path: string, file: Buffer, contentType: string) =>
      authorize(path).attach('file', file, {
        filename: 'shirt.bin',
        contentType,
      });
    const png = imageBytes('image/png');

    const missingFile = await authorize(`/v1/products/${product.id}/images`)
      .field('primary', 'false')
      .expect(422);
    expect((missingFile.body as ValidationBody).errors).toContainEqual({
      field: 'file',
      message: 'file is required',
    });

    await attach(
      `/v1/products/${product.id}/images`,
      Buffer.alloc(4, 1),
      'image/gif',
    ).expect(415);
    await attach(
      `/v1/products/${product.id}/images`,
      imageBytes('image/png', IMAGE_MAX_BYTES + 1),
      'image/png',
    ).expect(413);
    await attach(
      `/v1/products/${product.id}/images`,
      imageBytes('image/jpeg', IMAGE_MAX_BYTES),
      'image/jpeg',
    ).expect(201);

    await attach(`/v1/products/${product.id}/images`, png, 'image/png')
      .field('primary', 'TRUE')
      .expect(422);
    await attach(`/v1/products/${product.id}/images`, png, 'image/png')
      .field('skuIds', sku.id)
      .field('skuIds', sku.id)
      .expect(422);
    await attach('/v1/products/not-a-uuid/images', png, 'image/png').expect(
      422,
    );
    await attach(
      `/v1/products/${randomUUID()}/images`,
      png,
      'image/png',
    ).expect(404);
  });

  it('answers 415 for bytes that are not the declared image and stores nothing', async () => {
    const product = await createProduct();
    const manager = await login('MANAGER');
    const path = `/v1/products/${product.id}/images`;
    const upload = (file: Buffer, contentType: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .attach('file', file, { filename: 'shirt.img', contentType });

    const refusals = [
      await upload(Buffer.alloc(4, 1), 'image/gif').expect(415),
      await upload(Buffer.from('not an image, only text'), 'image/png').expect(
        415,
      ),
      await upload(imageBytes('image/jpeg'), 'image/webp').expect(415),
    ];

    for (const response of refusals) {
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.body).toEqual({
        type: 'about:blank',
        title: 'Unsupported Media Type',
        status: 415,
        instance: path,
      });
    }
    expect(storageUpload).not.toHaveBeenCalled();
    expect(
      await prisma.productImage.count({ where: { productId: product.id } }),
    ).toBe(0);

    const png = imageBytes('image/png');
    await upload(png, 'image/png').expect(201);
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(storageUpload).toHaveBeenCalledWith({
      body: png,
      contentType: 'image/png',
      prefix: `products/${product.id}`,
    });
  });

  it('answers an unexpected or repeated file part with 422', async () => {
    const product = await createProduct();
    const manager = await login('MANAGER');
    const upload = () =>
      request(app.getHttpServer())
        .post(`/v1/products/${product.id}/images`)
        .set('Authorization', `Bearer ${manager.accessToken}`);
    const image = { filename: 'shirt.png', contentType: 'image/png' };
    const png = imageBytes('image/png');

    const cases = [
      {
        field: 'photo',
        response: await upload().attach('photo', png, image).expect(422),
      },
      {
        field: 'photo',
        response: await upload()
          .attach('file', png, image)
          .attach('photo', png, image)
          .expect(422),
      },
      {
        field: 'file',
        response: await upload()
          .attach('file', png, image)
          .attach('file', png, image)
          .expect(422),
      },
    ];

    for (const { field, response } of cases) {
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.body).toMatchObject({
        type: 'about:blank',
        title: 'Unprocessable Content',
        status: 422,
      });
      expect((response.body as ValidationBody).errors).toEqual([
        { field, message: 'only one file part, named file, is accepted' },
      ]);
    }
    expect(storageUpload).not.toHaveBeenCalled();
    expect(
      await prisma.productImage.count({ where: { productId: product.id } }),
    ).toBe(0);
  });

  it('answers a text part over the field size limit with 422', async () => {
    const product = await createProduct();
    const manager = await login('MANAGER');

    const response = await request(app.getHttpServer())
      .post(`/v1/products/${product.id}/images`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .attach('file', imageBytes('image/png'), {
        filename: 'shirt.png',
        contentType: 'image/png',
      })
      .field('skuIds', 'a'.repeat(1024 * 1024 + 1))
      .expect(422);

    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect((response.body as ValidationBody).errors).toEqual([
      { field: 'skuIds', message: 'value is too long' },
    ]);
    expect(storageUpload).not.toHaveBeenCalled();
  });
});
