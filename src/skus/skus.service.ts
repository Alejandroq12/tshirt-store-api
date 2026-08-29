import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type ProductSku, UserRole } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { EnvironmentVariables } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSkuRequest, UpdateSkuRequest } from './skus.dto';

const SKU_DETAIL_INCLUDE = {
  product: {
    select: {
      images: {
        where: { isFallback: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          skuAssignments: {
            orderBy: [{ createdAt: 'asc' }, { skuId: 'asc' }],
            select: { skuId: true, isPrimary: true },
          },
        },
      },
    },
  },
  imageAssignments: {
    orderBy: [{ createdAt: 'asc' }, { imageId: 'asc' }],
    include: {
      image: {
        include: {
          skuAssignments: {
            orderBy: [{ createdAt: 'asc' }, { skuId: 'asc' }],
            select: { skuId: true, isPrimary: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductSkuInclude;

type SkuDetailRecord = Prisma.ProductSkuGetPayload<{
  include: typeof SKU_DETAIL_INCLUDE;
}>;

type ResolvedImage =
  | SkuDetailRecord['product']['images'][number]
  | SkuDetailRecord['imageAssignments'][number]['image'];

type SkuCore = Pick<
  ProductSku,
  | 'id'
  | 'productId'
  | 'skuCode'
  | 'size'
  | 'color'
  | 'price'
  | 'stockQuantity'
  | 'createdAt'
  | 'updatedAt'
>;

export interface SkuResponse {
  id: string;
  productId: string;
  skuCode: string;
  size: string;
  color: string;
  price: string;
  currency: string;
  stockQuantity: number;
  createdAt: string;
  updatedAt: string;
}

interface ImageAssetResponse {
  id: string;
  productId: string;
  url: string;
  skuIds: string[];
  isProductPrimary: boolean;
  primaryForSkuIds: string[];
  createdAt: string;
}

export interface SkuDetailResponse extends SkuResponse {
  images: ImageAssetResponse[];
  primaryImageId: string | null;
  imageSource: 'sku' | 'product' | 'none';
}

const visibleSkuWhere = (
  user?: AuthenticatedUser,
): Prisma.ProductSkuWhereInput =>
  user?.role === UserRole.MANAGER
    ? {}
    : { product: { isActive: true, deletedAt: null } };

@Injectable()
export class SkusService {
  private readonly currency: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.currency = config.get('STORE_CURRENCY', { infer: true });
  }

  async create(input: CreateSkuRequest): Promise<SkuResponse> {
    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true },
    });

    if (!product) throw new NotFoundException();

    return this.skuResponse(
      await this.prisma.productSku.create({
        data: {
          productId: input.productId,
          skuCode: input.skuCode,
          size: input.size,
          color: input.color,
          price: input.price,
          stockQuantity: input.stockQuantity,
        },
      }),
    );
  }

  async get(
    skuId: string,
    user?: AuthenticatedUser,
  ): Promise<SkuDetailResponse> {
    const sku = await this.prisma.productSku.findFirst({
      where: { id: skuId, ...visibleSkuWhere(user) },
      include: SKU_DETAIL_INCLUDE,
    });

    if (!sku) throw new NotFoundException();

    const usesSkuImages = sku.imageAssignments.length > 0;
    const images = usesSkuImages
      ? sku.imageAssignments.map(({ image }) => image)
      : sku.product.images;
    const primaryImageId = usesSkuImages
      ? (sku.imageAssignments.find(({ isPrimary }) => isPrimary)?.imageId ??
        null)
      : (images.find(({ isProductPrimary }) => isProductPrimary)?.id ?? null);

    return {
      ...this.skuResponse(sku),
      images: images.map((image) => this.imageResponse(image)),
      primaryImageId,
      imageSource: usesSkuImages
        ? 'sku'
        : images.length > 0
          ? 'product'
          : 'none',
    };
  }

  async update(skuId: string, input: UpdateSkuRequest): Promise<SkuResponse> {
    return this.skuResponse(
      await this.prisma.productSku.update({
        where: { id: skuId },
        data: {
          skuCode: input.skuCode,
          size: input.size,
          color: input.color,
          price: input.price,
          stockQuantity: input.stockQuantity,
        },
      }),
    );
  }

  private skuResponse(sku: SkuCore): SkuResponse {
    return {
      id: sku.id,
      productId: sku.productId,
      skuCode: sku.skuCode,
      size: sku.size,
      color: sku.color,
      price: sku.price.toFixed(2),
      currency: this.currency,
      stockQuantity: sku.stockQuantity,
      createdAt: sku.createdAt.toISOString(),
      updatedAt: sku.updatedAt.toISOString(),
    };
  }

  private imageResponse(image: ResolvedImage): ImageAssetResponse {
    return {
      id: image.id,
      productId: image.productId,
      url: image.url,
      skuIds: image.skuAssignments.map(({ skuId }) => skuId),
      isProductPrimary: image.isProductPrimary,
      primaryForSkuIds: image.skuAssignments
        .filter(({ isPrimary }) => isPrimary)
        .map(({ skuId }) => skuId),
      createdAt: image.createdAt.toISOString(),
    };
  }
}
