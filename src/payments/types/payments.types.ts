export interface PaymentLinkResponse {
  id: string;
  skuId: string;
  quantity: number;
  url: string;
  createdAt: string;
}

export interface PaymentIntentResponse {
  id: string;
  orderId: string;
  clientSecret: string;
  amount: string;
  currency: string;
}
