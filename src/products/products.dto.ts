import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum ProductStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  RETIRED = 'retired',
}

export class ListProductsQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  category?: string;
}

export class ProductIdParams {
  @IsUUID()
  productId!: string;
}

export class CreateProductRequest {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class UpdateProductRequest {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
