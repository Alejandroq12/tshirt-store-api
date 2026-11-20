import { IsInt, IsUUID, Max, Min } from 'class-validator';

import { INT4_MAX } from '../common/validation/int4';

export class PaymentLinkCreateRequest {
  @IsUUID()
  skuId!: string;

  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  quantity!: number;
}

export class PaymentIntentCreateRequest {
  @IsUUID()
  orderId!: string;
}
