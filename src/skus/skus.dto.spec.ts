import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateSkuRequest, UpdateSkuRequest } from './skus.dto';

const SKU = {
  productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  skuCode: 'CREW-BLUE-M',
  size: 'M',
  color: 'Blue',
  price: '19.90',
  stockQuantity: 4,
};

const failingProperties = (type: new () => object, value: object): string[] =>
  validateSync(plainToInstance(type, value)).map(({ property }) => property);

describe('CreateSkuRequest', () => {
  // PositiveAmount: a canonical positive decimal(10,2) amount.
  it.each(['0.01', '19.90', '99999999.99'])(
    'accepts the canonical positive amount %p',
    (price) => {
      expect(failingProperties(CreateSkuRequest, { ...SKU, price })).toEqual(
        [],
      );
    },
  );

  it.each([
    '0.00',
    '100000000.00',
    '01.00',
    '1.999',
    '1.9',
    '1',
    '-1.00',
    ' 1.00',
    19.9,
  ])('rejects the price %p', (price) => {
    expect(failingProperties(CreateSkuRequest, { ...SKU, price })).toEqual([
      'price',
    ]);
  });
});

describe('UpdateSkuRequest', () => {
  it.each(['0.00', '100000000.00', 25])('rejects the price %p', (price) => {
    expect(failingProperties(UpdateSkuRequest, { price })).toEqual(['price']);
  });
});
