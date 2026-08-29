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

import { OptionalProperty } from '../common/validation/optional-property.decorator';

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
  @OptionalProperty()
  @IsUUID()
  categoryId?: string;

  @OptionalProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @OptionalProperty()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
