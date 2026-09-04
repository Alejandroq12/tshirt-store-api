import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Product, UserRole } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { EnvironmentVariables } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductRequest,
  LikeUpdateRequest,
  ListProductsQuery,
  ProductStatus,
  UpdateProductRequest,
} from './products.dto';

const PRODUCT_LIST_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  images: {
    where: { isFallback: true, isProductPrimary: true },
    select: { url: true },
    take: 1,
  },
} satisfies Prisma.ProductInclude;

const PRODUCT_DETAIL_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  images: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      skuAssignments: {
        orderBy: [{ createdAt: 'asc' }, { skuId: 'asc' }],
        select: { skuId: true, isPrimary: true },
      },
    },
  },
  skus: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      imageAssignments: {
        orderBy: [{ createdAt: 'asc' }, { imageId: 'asc' }],
        select: { imageId: true, isPrimary: true },
      },
    },
  },
} satisfies Prisma.ProductInclude;

type ProductDetailRecord = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_DETAIL_INCLUDE;
}>;

type ProductCore = Pick<
  Product,
  | 'id'
  | 'categoryId'
  | 'name'
  | 'description'
  | 'isActive'
  | 'deletedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export interface ProductResponse {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  status: ProductStatus;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LikeStateResponse {
  productId: string;
  liked: boolean;
}

interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
}

export interface ProductPageResponse {
  items: Array<{
    id: string;
    category: CategoryResponse;
    name: string;
    description: string | null;
    status: ProductStatus;
    primaryImageUrl: string | null;
    liked: boolean | null;
  }>;
  pagination: { limit: number; offset: number; total: number };
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

interface CatalogSkuResponse {
  id: string;
  productId: string;
  skuCode: string;
  size: string;
  color: string;
  price: string;
  currency: string;
  stockQuantity: number;
  imageIds: string[];
  primaryImageId: string | null;
  imageSource: 'sku' | 'product' | 'none';
}

export interface ProductDetailResponse extends ProductResponse {
  category: CategoryResponse;
  imageAssets: ImageAssetResponse[];
  fallbackImageIds: string[];
  primaryImageId: string | null;
  skus: CatalogSkuResponse[];
  liked: boolean | null;
}

const statusOf = (product: Pick<Product, 'isActive' | 'deletedAt'>) => {
  if (product.deletedAt) return ProductStatus.RETIRED;
  return product.isActive ? ProductStatus.ACTIVE : ProductStatus.INACTIVE;
};

const productResponse = (product: ProductCore): ProductResponse => ({
  id: product.id,
  categoryId: product.categoryId,
  name: product.name,
  description: product.description,
  status: statusOf(product),
  retiredAt: product.deletedAt?.toISOString() ?? null,
  createdAt: product.createdAt.toISOString(),
  updatedAt: product.updatedAt.toISOString(),
});

const visibleProductWhere = (
  user?: AuthenticatedUser,
): Prisma.ProductWhereInput =>
  user?.role === UserRole.MANAGER ? {} : { isActive: true, deletedAt: null };

const clientIdOf = (user?: AuthenticatedUser): string | undefined =>
  user?.role === UserRole.CLIENT ? user.id : undefined;

@Injectable()
export class ProductsService {
  private readonly currency: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.currency = config.get('STORE_CURRENCY', { infer: true });
  }

  async list(
    query: ListProductsQuery,
    user?: AuthenticatedUser,
  ): Promise<ProductPageResponse> {
    const where: Prisma.ProductWhereInput = {
      ...visibleProductWhere(user),
      ...(query.category === undefined
        ? {}
        : { category: { slug: query.category } }),
    };
    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
        include: PRODUCT_LIST_INCLUDE,
      }),
      this.prisma.product.count({ where }),
    ]);
    const clientId = clientIdOf(user);
    const likedIds = new Set(
      clientId && products.length > 0
        ? (
            await this.prisma.productLike.findMany({
              where: {
                clientId,
                productId: { in: products.map(({ id }) => id) },
              },
              select: { productId: true },
            })
          ).map(({ productId }) => productId)
        : [],
    );

    return {
      items: products.map((product) => ({
        id: product.id,
        category: product.category,
        name: product.name,
        description: product.description,
        status: statusOf(product),
        primaryImageUrl: product.images[0]?.url ?? null,
        liked: clientId ? likedIds.has(product.id) : null,
      })),
      pagination: { limit: query.limit, offset: query.offset, total },
    };
  }

  async create(input: CreateProductRequest): Promise<ProductResponse> {
    await this.requireCategory(input.categoryId);

    return productResponse(
      await this.prisma.product.create({
        data: {
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
        },
      }),
    );
  }

  async get(
    productId: string,
    user?: AuthenticatedUser,
  ): Promise<ProductDetailResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...visibleProductWhere(user) },
      include: PRODUCT_DETAIL_INCLUDE,
    });

    if (!product) throw new NotFoundException();

    const clientId = clientIdOf(user);
    const liked = clientId
      ? (await this.prisma.productLike.findFirst({
          where: { clientId, productId },
          select: { clientId: true },
        })) !== null
      : null;

    return this.detailResponse(product, liked);
  }

  async update(
    productId: string,
    input: UpdateProductRequest,
  ): Promise<ProductResponse> {
    const current = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!current) throw new NotFoundException();
    if (input.categoryId !== undefined) {
      await this.requireCategory(input.categoryId);
    }
    if (
      current.deletedAt &&
      input.status !== undefined &&
      input.status !== ProductStatus.RETIRED
    ) {
      throw new ConflictException();
    }
    if (input.status === ProductStatus.ACTIVE) {
      await this.requireUsablePrimaryImage(productId);
    }

    const result = await this.prisma.product.updateMany({
      where: {
        id: productId,
        ...(input.status === ProductStatus.ACTIVE ||
        input.status === ProductStatus.INACTIVE
          ? { deletedAt: null }
          : {}),
      },
      data: {
        categoryId: input.categoryId,
        name: input.name,
        description: input.description,
        ...this.lifecycleUpdate(input.status, current.deletedAt),
      },
    });

    if (result.count !== 1) throw new ConflictException();

    return productResponse(
      await this.prisma.product.findUniqueOrThrow({
        where: { id: productId },
      }),
    );
  }

  async setLiked(
    productId: string,
    input: LikeUpdateRequest,
    user: AuthenticatedUser,
  ): Promise<LikeStateResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...visibleProductWhere(user) },
      select: { id: true },
    });

    if (!product) throw new NotFoundException();

    if (input.liked) {
      try {
        await this.prisma.productLike.upsert({
          where: {
            clientId_productId: { clientId: user.id, productId },
          },
          create: { clientId: user.id, productId },
          update: {},
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
      }
    } else {
      await this.prisma.productLike.deleteMany({
        where: { clientId: user.id, productId },
      });
    }

    return { productId, liked: input.liked };
  }

  private async requireCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });

    if (!category) throw new NotFoundException();
  }

  private async requireUsablePrimaryImage(productId: string): Promise<void> {
    const image = await this.prisma.productImage.findFirst({
      where: {
        productId,
        isFallback: true,
        isProductPrimary: true,
        url: { not: '' },
        s3Key: { not: '' },
        skuAssignments: { none: {} },
      },
      select: { id: true },
    });

    if (!image) throw new ConflictException();
  }

  private lifecycleUpdate(
    status: ProductStatus | undefined,
    retiredAt: Date | null,
  ): Prisma.ProductUpdateManyMutationInput {
    if (status === ProductStatus.ACTIVE) {
      return { isActive: true, deletedAt: null };
    }
    if (status === ProductStatus.INACTIVE) {
      return { isActive: false, deletedAt: null };
    }
    if (status === ProductStatus.RETIRED) {
      return { isActive: false, deletedAt: retiredAt ?? new Date() };
    }
    return {};
  }

  private detailResponse(
    product: ProductDetailRecord,
    liked: boolean | null,
  ): ProductDetailResponse {
    const fallbackImages = product.images.filter(
      ({ isFallback }) => isFallback,
    );
    const fallbackImageIds = fallbackImages.map(({ id }) => id);
    const primaryImageId =
      fallbackImages.find(({ isProductPrimary }) => isProductPrimary)?.id ??
      null;

    return {
      ...productResponse(product),
      category: product.category,
      imageAssets: product.images.map((image) => ({
        id: image.id,
        productId: image.productId,
        url: image.url,
        skuIds: image.skuAssignments.map(({ skuId }) => skuId),
        isProductPrimary: image.isProductPrimary,
        primaryForSkuIds: image.skuAssignments
          .filter(({ isPrimary }) => isPrimary)
          .map(({ skuId }) => skuId),
        createdAt: image.createdAt.toISOString(),
      })),
      fallbackImageIds,
      primaryImageId,
      skus: product.skus.map((sku) => {
        const usesSkuImages = sku.imageAssignments.length > 0;
        const imageIds = usesSkuImages
          ? sku.imageAssignments.map(({ imageId }) => imageId)
          : fallbackImageIds;
        const skuPrimaryImageId = usesSkuImages
          ? (sku.imageAssignments.find(({ isPrimary }) => isPrimary)?.imageId ??
            null)
          : primaryImageId;

        return {
          id: sku.id,
          productId: sku.productId,
          skuCode: sku.skuCode,
          size: sku.size,
          color: sku.color,
          price: sku.price.toFixed(2),
          currency: this.currency,
          stockQuantity: sku.stockQuantity,
          imageIds,
          primaryImageId: skuPrimaryImageId,
          imageSource: usesSkuImages
            ? 'sku'
            : fallbackImageIds.length > 0
              ? 'product'
              : 'none',
        };
      }),
      liked,
    };
  }
}
