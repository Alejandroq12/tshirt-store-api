import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  PaymentIntentCreateRequest,
  PaymentLinkCreateRequest,
} from './payments.dto';

const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const SKU_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

describe('PaymentIntentCreateRequest', () => {
  it('requires a UUID order id to create a Payment Intent', () => {
    const valid = plainToInstance(PaymentIntentCreateRequest, {
      orderId: ORDER_ID,
    });
    const malformed = plainToInstance(PaymentIntentCreateRequest, {
      orderId: 'not-a-uuid',
    });
    const missing = plainToInstance(PaymentIntentCreateRequest, {});

    expect(validateSync(valid)).toHaveLength(0);
    expect(validateSync(malformed).map((error) => error.property)).toEqual([
      'orderId',
    ]);
    expect(validateSync(missing).map((error) => error.property)).toEqual([
      'orderId',
    ]);
  });
});

describe('PaymentLinkCreateRequest', () => {
  it('requires a UUID SKU and a positive integer quantity for a Payment Link', () => {
    const valid = plainToInstance(PaymentLinkCreateRequest, {
      skuId: SKU_ID,
      quantity: 1,
    });

    expect(validateSync(valid)).toHaveLength(0);

    for (const [value, property] of [
      [{ skuId: 'not-a-uuid', quantity: 1 }, 'skuId'],
      [{ quantity: 1 }, 'skuId'],
      [{ skuId: SKU_ID, quantity: 0 }, 'quantity'],
      [{ skuId: SKU_ID, quantity: 1.5 }, 'quantity'],
      [{ skuId: SKU_ID, quantity: '2' }, 'quantity'],
      [{ skuId: SKU_ID }, 'quantity'],
    ] as const) {
      const input = plainToInstance(PaymentLinkCreateRequest, value);

      expect(validateSync(input).map((error) => error.property)).toEqual([
        property,
      ]);
    }
  });
});

// payment_links.quantity is an int column.
describe('PaymentLinkCreateRequest quantity', () => {
  it('accepts the largest int, 2147483647', () => {
    const input = plainToInstance(PaymentLinkCreateRequest, {
      skuId: SKU_ID,
      quantity: 2147483647,
    });

    expect(validateSync(input)).toHaveLength(0);
  });

  it('rejects 2147483648, which the int column cannot hold', () => {
    const input = plainToInstance(PaymentLinkCreateRequest, {
      skuId: SKU_ID,
      quantity: 2147483648,
    });

    expect(validateSync(input).map((error) => error.property)).toEqual([
      'quantity',
    ]);
  });
});
