import { IsInt, IsUUID, Min } from 'class-validator';

export class CartItemIdParams {
  @IsUUID()
  itemId!: string;
}

export class CartItemCreateRequest {
  @IsUUID()
  skuId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CartItemUpdateRequest {
  @IsInt()
  @Min(1)
  quantity!: number;
}
