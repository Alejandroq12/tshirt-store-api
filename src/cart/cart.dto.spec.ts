import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CartItemCreateRequest } from './cart.dto';

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
