import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { OptionalProperty } from '../common/validation/optional-property.decorator';

const POSITIVE_AMOUNT = /^(?!0\.00$)(0|[1-9]\d{0,7})\.\d{2}$/;

export class SkuIdParams {
  @IsUUID()
  skuId!: string;
}

export class CreateSkuRequest {
  @IsUUID()
  productId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  skuCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  size!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  color!: string;

  @IsString()
  @Matches(POSITIVE_AMOUNT)
  price!: string;

  @IsInt()
  @Min(0)
  stockQuantity!: number;
}

export class UpdateSkuRequest {
  @OptionalProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  skuCode?: string;

  @OptionalProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  size?: string;

  @OptionalProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  color?: string;

  @OptionalProperty()
  @IsString()
  @Matches(POSITIVE_AMOUNT)
  price?: string;

  @OptionalProperty()
  @IsInt()
  @Min(0)
  stockQuantity?: number;
}
