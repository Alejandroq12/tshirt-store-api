export interface CartItemResponse {
  id: string;
  skuId: string;
  productId: string;
  productName: string;
  skuCode: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface CartResponse {
  id: string;
  items: CartItemResponse[];
  subtotalAmount: string;
  currency: string;
  updatedAt: string;
}
