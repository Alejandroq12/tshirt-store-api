import { applyDecorators } from '@nestjs/common';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsInt } from 'class-validator';

const DECIMAL_DIGITS = /^\d+$/;

// Number() also reads '0x10', '1e1', '+5', ' 5', '5.0' and '' as integers.
// Only a digit-only string is converted; anything else reaches IsInt as it
// arrived and fails there.
const toDecimalInteger = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && DECIMAL_DIGITS.test(value)
    ? Number(value)
    : value;

export const IntegerQuery = () =>
  applyDecorators(Transform(toDecimalInteger), IsInt());
