import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type ProductImage } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  S3StorageService,
  type UploadRequest,
} from '../storage/s3-storage.service';
import type { UploadProductImageRequest } from './images.dto';

export interface ImageAssetResponse {
  id: string;
  productId: string;
  url: string;
  skuIds: string[];
  isProductPrimary: boolean;
  primaryForSkuIds: string[];
  createdAt: string;
}

interface PersistedImage {
  image: ProductImage;
  primaryForSkuIds: string[];
}

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
  ) {}

  async upload(
    productId: string,
    input: UploadProductImageRequest,
    file: Pick<UploadRequest, 'body' | 'contentType'>,
  ): Promise<ImageAssetResponse> {
    const skuIds = input.skuIds ?? [];
    await this.requireProductAndSkus(productId, skuIds);

    const stored = await this.storage.upload({
      ...file,
      prefix: `products/${productId}`,
    });

    try {
      const persisted = await this.prisma.$transaction((transaction) =>
        skuIds.length === 0
          ? this.createFallback(
              transaction,
              productId,
              stored.key,
              stored.url,
              input.primary === true,
            )
          : this.createVariant(
              transaction,
              productId,
              skuIds,
              stored.key,
              stored.url,
              input.primary === true,
            ),
      );

      return {
        id: persisted.image.id,
        productId: persisted.image.productId,
        url: persisted.image.url,
        skuIds,
        isProductPrimary: persisted.image.isProductPrimary,
        primaryForSkuIds: persisted.primaryForSkuIds,
        createdAt: persisted.image.createdAt.toISOString(),
      };
    } catch (error) {
      await this.removeFailedUpload(stored.key);
      throw error;
    }
  }

  private async requireProductAndSkus(
    productId: string,
    skuIds: string[],
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!product) throw new NotFoundException();
    if (skuIds.length === 0) return;

    const skuCount = await this.prisma.productSku.count({
      where: { productId, id: { in: skuIds } },
    });

    if (skuCount !== skuIds.length) throw new NotFoundException();
  }

  private async createFallback(
    transaction: Prisma.TransactionClient,
    productId: string,
    key: string,
    url: string,
    replacePrimary: boolean,
  ): Promise<PersistedImage> {
    let isPrimary = replacePrimary;

    if (replacePrimary) {
      await transaction.productImage.updateMany({
        where: { productId, isFallback: true, isProductPrimary: true },
        data: { isProductPrimary: false },
      });
    } else {
      const currentPrimary = await transaction.productImage.findFirst({
        where: { productId, isFallback: true, isProductPrimary: true },
        select: { id: true },
      });
      isPrimary = currentPrimary === null;
    }

    const image = await transaction.productImage.create({
      data: {
        productId,
        url,
        s3Key: key,
        isFallback: true,
        isProductPrimary: isPrimary,
      },
    });

    return { image, primaryForSkuIds: [] };
  }

  private async createVariant(
    transaction: Prisma.TransactionClient,
    productId: string,
    skuIds: string[],
    key: string,
    url: string,
    replacePrimary: boolean,
  ): Promise<PersistedImage> {
    let primaryForSkuIds: string[];

    if (replacePrimary) {
      await transaction.skuImageAssignment.updateMany({
        where: { skuId: { in: skuIds }, isPrimary: true },
        data: { isPrimary: false },
      });
      primaryForSkuIds = skuIds;
    } else {
      const currentPrimaries = await transaction.skuImageAssignment.findMany({
        where: { skuId: { in: skuIds }, isPrimary: true },
        select: { skuId: true },
      });
      const assigned = new Set(currentPrimaries.map(({ skuId }) => skuId));
      primaryForSkuIds = skuIds.filter((skuId) => !assigned.has(skuId));
    }

    const primaryIds = new Set(primaryForSkuIds);
    const image = await transaction.productImage.create({
      data: {
        productId,
        url,
        s3Key: key,
        isFallback: false,
        isProductPrimary: false,
        skuAssignments: {
          create: skuIds.map((skuId) => ({
            skuId,
            isPrimary: primaryIds.has(skuId),
          })),
        },
      },
    });

    return { image, primaryForSkuIds };
  }

  private async removeFailedUpload(key: string): Promise<void> {
    try {
      await this.storage.remove(key);
    } catch (error) {
      this.logger.error(
        `Failed to remove image object ${key}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
