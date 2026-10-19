import { ProductStatus } from '../products.dto';

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
