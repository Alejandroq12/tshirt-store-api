import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { IntegerQuery } from '../common/validation/integer-query.decorator';
import { MaxCodePoints } from '../common/validation/max-code-points.decorator';
import { MinCodePoints } from '../common/validation/min-code-points.decorator';
import { OptionalProperty } from '../common/validation/optional-property.decorator';

export enum ProductStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  RETIRED = 'retired',
}

export class ListProductsQuery {
  @IntegerQuery()
  @Min(1)
  limit!: number;

  @IntegerQuery()
  @Min(0)
  offset!: number;

  @IsOptional()
  @IsString()
  @MinCodePoints(1)
  category?: string;
}

export class ProductIdParams {
  @IsUUID()
  productId!: string;
}

export class LikeUpdateRequest {
  @IsBoolean()
  liked!: boolean;
}

export class CreateProductRequest {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @MinCodePoints(1)
  @MaxCodePoints(200)
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
  @MinCodePoints(1)
  @MaxCodePoints(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @OptionalProperty()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
