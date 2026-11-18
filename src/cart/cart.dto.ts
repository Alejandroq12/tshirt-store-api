import { IsInt, IsUUID, Max, Min } from 'class-validator';

import { INT4_MAX } from '../common/validation/int4';

export class CartItemIdParams {
  @IsUUID()
  itemId!: string;
}

export class CartItemCreateRequest {
  @IsUUID()
  skuId!: string;

  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  quantity!: number;
}

export class CartItemUpdateRequest {
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  quantity!: number;
}
