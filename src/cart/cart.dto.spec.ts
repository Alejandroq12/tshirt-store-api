import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CartItemCreateRequest,
  CartItemIdParams,
  CartItemUpdateRequest,
} from './cart.dto';

const SKU_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

describe('CartItemCreateRequest', () => {
  it('accepts a UUID SKU and a positive integer quantity', () => {
    const input = plainToInstance(CartItemCreateRequest, {
      skuId: SKU_ID,
      quantity: 2,
    });

    expect(validateSync(input)).toHaveLength(0);
  });

  it.each([
    [{ skuId: 'not-a-uuid', quantity: 1 }, 'skuId'],
    [{ skuId: SKU_ID, quantity: 0 }, 'quantity'],
    [{ skuId: SKU_ID, quantity: 1.5 }, 'quantity'],
    // The global ValidationPipe transforms without implicit conversion, so a
    // numeric string stays a string and must be rejected.
    [{ skuId: SKU_ID, quantity: '2' }, 'quantity'],
    [{ quantity: 1 }, 'skuId'],
    [{ skuId: SKU_ID }, 'quantity'],
  ])('rejects an invalid cart item body: %p', (value, property) => {
    const input = plainToInstance(CartItemCreateRequest, value);

    expect(validateSync(input).map((error) => error.property)).toEqual([
      property,
    ]);
  });
});

describe('CartItemUpdateRequest', () => {
  it.each([{}, { quantity: 0 }, { quantity: 1.5 }, { quantity: '2' }])(
    'rejects a quantity update that is missing, below 1 or not an integer: %p',
    (value) => {
      const input = plainToInstance(CartItemUpdateRequest, value);

      expect(validateSync(input).map((error) => error.property)).toEqual([
        'quantity',
      ]);
    },
  );
});

// cart_items.quantity is an int column.
describe.each([
  { type: CartItemCreateRequest, body: { skuId: SKU_ID } },
  { type: CartItemUpdateRequest, body: {} },
])('$type.name quantity', ({ type, body }) => {
  const failingProperties = (quantity: number): string[] =>
    validateSync(plainToInstance(type, { ...body, quantity })).map(
      (error) => error.property,
    );

  it('accepts the largest int, 2147483647', () => {
    expect(failingProperties(2147483647)).toEqual([]);
  });

  it('rejects 2147483648, which the int column cannot hold', () => {
    expect(failingProperties(2147483648)).toEqual(['quantity']);
  });
});

describe('CartItemIdParams', () => {
  it('rejects a malformed cart item id', () => {
    const input = plainToInstance(CartItemIdParams, { itemId: 'not-a-uuid' });

    expect(validateSync(input).map((error) => error.property)).toEqual([
      'itemId',
    ]);
  });
});
