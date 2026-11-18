import { buildMessage, ValidateBy } from 'class-validator';

// class-validator's MaxLength measures with validator.js isLength, which does
// not count a U+FE0E or U+FE0F variation selector that follows a character.
// The contract's maxLength and a varchar(n) column both count code points, so
// a string MaxLength accepts could still be too long for the column.
export const MaxCodePoints = (max: number) =>
  ValidateBy({
    name: 'maxCodePoints',
    constraints: [max],
    validator: {
      validate: (value: unknown): boolean =>
        typeof value === 'string' && [...value].length <= max,
      defaultMessage: buildMessage(
        (eachPrefix) =>
          `${eachPrefix}$property must be shorter than or equal to $constraint1 characters`,
      ),
    },
  });
