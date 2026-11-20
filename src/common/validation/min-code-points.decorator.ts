import { buildMessage, ValidateBy } from 'class-validator';

// class-validator's MinLength measures with validator.js isLength, which does
// not count a U+FE0E or U+FE0F variation selector that follows a character.
// The contract's minLength counts code points, so MinLength(8) rejects four
// character-and-selector pairs, which are eight code points.
export const MinCodePoints = (min: number) =>
  ValidateBy({
    name: 'minCodePoints',
    constraints: [min],
    validator: {
      validate: (value: unknown): boolean =>
        typeof value === 'string' && [...value].length >= min,
      defaultMessage: buildMessage(
        (eachPrefix) =>
          `${eachPrefix}$property must be longer than or equal to $constraint1 characters`,
      ),
    },
  });
