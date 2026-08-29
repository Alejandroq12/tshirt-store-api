import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  skuCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  size?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  color?: string;

  @IsOptional()
  @IsString()
  @Matches(POSITIVE_AMOUNT)
  price?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;
}
