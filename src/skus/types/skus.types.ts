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

export interface ImageAssetResponse {
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
