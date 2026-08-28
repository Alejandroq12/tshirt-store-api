import { ValidationError } from 'class-validator';

import { flattenValidationErrors } from './validation-errors';

const error = (partial: Partial<ValidationError>): ValidationError =>
  Object.assign(new ValidationError(), partial);

describe('flattenValidationErrors', () => {
  it('turns one failed property into one field/message pair', () => {
    const result = flattenValidationErrors([
      error({
        property: 'email',
        constraints: { isEmail: 'Must be a valid email address.' },
      }),
    ]);

    expect(result).toEqual([
      { field: 'email', message: 'Must be a valid email address.' },
    ]);
  });

  it('emits one entry per broken constraint on the same property', () => {
    const result = flattenValidationErrors([
      error({
        property: 'password',
        constraints: {
          minLength: 'password must be longer than 8 characters',
          matches: 'password must contain a digit',
        },
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.every((entry) => entry.field === 'password')).toBe(true);
  });

  it('keeps the path through nested objects', () => {
    const result = flattenValidationErrors([
      error({
        property: 'address',
        children: [
          error({
            property: 'postalCode',
            constraints: { isPostalCode: 'invalid postal code' },
          }),
        ],
      }),
    ]);

    expect(result).toEqual([
      { field: 'address.postalCode', message: 'invalid postal code' },
    ]);
  });

  it('renders array positions as indexes, not as dotted numbers', () => {
    const result = flattenValidationErrors([
      error({
        property: 'items',
        children: [
          error({
            property: '0',
            children: [
              error({
                property: 'skuId',
                constraints: { isUuid: 'skuId must be a UUID' },
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(result).toEqual([
      { field: 'items[0].skuId', message: 'skuId must be a UUID' },
    ]);
  });

  it('reports an unknown property, which is how forbidNonWhitelisted rejects', () => {
    const result = flattenValidationErrors([
      error({
        property: 'nickname',
        constraints: {
          whitelistValidation: 'property nickname should not exist',
        },
      }),
    ]);

    expect(result).toEqual([
      { field: 'nickname', message: 'property nickname should not exist' },
    ]);
  });

  it('returns nothing when nothing failed', () => {
    expect(flattenValidationErrors([])).toEqual([]);
  });
});
