import { IsInt, IsUUID, Min } from 'class-validator';

export class PaymentLinkCreateRequest {
  @IsUUID()
  skuId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class PaymentIntentCreateRequest {
  @IsUUID()
  orderId!: string;
}
