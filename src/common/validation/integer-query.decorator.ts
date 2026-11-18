import { applyDecorators } from '@nestjs/common';
import { Transform, type TransformFnParams } from 'class-transformer';
import { ValidateBy, type ValidationArguments } from 'class-validator';

const DECIMAL_DIGITS = /^\d+$/;

// Number() also reads '0x10', '1e1', '+5', ' 5', '5.0' and '' as integers.
// Only a digit-only string is converted; anything else reaches the validator
// as it arrived and fails there.
const toDecimalInteger = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && DECIMAL_DIGITS.test(value)
    ? Number(value)
    : value;

// Past 2^53 - 1 a digit string has no exact Number, and past 2^63 - 1 Prisma
// cannot fit it into take or skip. It is still converted, so a sibling Min
// sees a large number rather than a string it would also call too small.
const IsSafeInteger = () =>
  ValidateBy({
    name: 'isSafeInteger',
    validator: {
      validate: (value: unknown) => Number.isSafeInteger(value),
      defaultMessage: ({ property, value }: ValidationArguments) =>
        typeof value === 'number' && value > Number.MAX_SAFE_INTEGER
          ? `${property} must not be greater than ${Number.MAX_SAFE_INTEGER}`
          : `${property} must be an integer number`,
    },
  });

export const IntegerQuery = () =>
  applyDecorators(Transform(toDecimalInteger), IsSafeInteger());
