export interface OrderItemResponse {
  id: string;
  productId: string;
  skuId: string;
  productName: string;
  skuCode: string;
  size: string;
  color: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrderResponse {
  id: string;
  clientId: string;
  status: 'pending' | 'paid' | 'processing' | 'shipped' | 'cancelled';
  paymentMethod: 'payment_link' | 'payment_intent';
  items: OrderItemResponse[];
  totalAmount: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
}

export interface OrderPageResponse {
  items: OrderResponse[];
  pagination: { limit: number; offset: number; total: number };
}
