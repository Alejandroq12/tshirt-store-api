export interface ImageAssetResponse {
  id: string;
  productId: string;
  url: string;
  skuIds: string[];
  isProductPrimary: boolean;
  primaryForSkuIds: string[];
  createdAt: string;
}
