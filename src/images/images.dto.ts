import { Transform, type TransformFnParams } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsUUID } from 'class-validator';

import { OptionalProperty } from '../common/validation/optional-property.decorator';

const toArray = ({ value }: TransformFnParams): unknown => {
  if (value === undefined || Array.isArray(value)) return value;
  return [value];
};

const toBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class UploadProductImageRequest {
  @Transform(toArray)
  @OptionalProperty()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  skuIds?: string[];

  @Transform(toBoolean)
  @OptionalProperty()
  @IsBoolean()
  primary?: boolean;
}
