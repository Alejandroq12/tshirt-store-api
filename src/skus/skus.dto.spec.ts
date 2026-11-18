import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidatorOptions } from 'class-validator';

import { CreateSkuRequest, SkuIdParams, UpdateSkuRequest } from './skus.dto';

const SKU = {
  productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  skuCode: 'CREW-BLUE-M',
  size: 'M',
  color: 'Blue',
  price: '19.90',
  stockQuantity: 4,
};

// The global ValidationPipe rejects properties the DTO does not declare.
const PIPE_OPTIONS: ValidatorOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

const failingProperties = (
  type: new () => object,
  value: object,
  options?: ValidatorOptions,
): string[] =>
  validateSync(plainToInstance(type, value), options).map(
    ({ property }) => property,
  );

// validator.js isLength counts each pair as one character; the contract's
// maxLength and the varchar columns count two code points.
const VARIATION_PAIR = 'A\uFE0F';

const TEXT_MAXIMUMS = [
  ['skuCode', 64],
  ['size', 20],
  ['color', 40],
] as const;

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

  it('accepts a zero stock quantity', () => {
    expect(
      failingProperties(CreateSkuRequest, { ...SKU, stockQuantity: 0 }),
    ).toEqual([]);
  });

  it.each([-1, 1.5, '4', null])(
    'rejects the stock quantity %p',
    (stockQuantity) => {
      expect(
        failingProperties(CreateSkuRequest, { ...SKU, stockQuantity }),
      ).toEqual(['stockQuantity']);
    },
  );

  it.each(TEXT_MAXIMUMS)(
    'accepts %s up to %i characters and rejects it empty or longer',
    (property, maximum) => {
      expect(
        failingProperties(CreateSkuRequest, {
          ...SKU,
          [property]: 'x'.repeat(maximum),
        }),
      ).toEqual([]);
      expect(
        failingProperties(CreateSkuRequest, {
          ...SKU,
          [property]: 'x'.repeat(maximum + 1),
        }),
      ).toEqual([property]);
      expect(
        failingProperties(CreateSkuRequest, { ...SKU, [property]: '' }),
      ).toEqual([property]);
    },
  );

  it('rejects a product id that is not a UUID', () => {
    expect(
      failingProperties(CreateSkuRequest, { ...SKU, productId: 'not-a-uuid' }),
    ).toEqual(['productId']);
  });

  it('lists every required property of an empty body', () => {
    expect(failingProperties(CreateSkuRequest, {}).sort()).toEqual([
      'color',
      'price',
      'productId',
      'size',
      'skuCode',
      'stockQuantity',
    ]);
  });

  it('rejects an unknown property under the pipe options', () => {
    expect(
      failingProperties(
        CreateSkuRequest,
        { ...SKU, currency: 'USD' },
        PIPE_OPTIONS,
      ),
    ).toEqual(['currency']);
  });
});

describe('UpdateSkuRequest', () => {
  // SkuUpdate's minProperties is enforced by the controller, not the DTO.
  it('lets an empty body through to the controller', () => {
    expect(failingProperties(UpdateSkuRequest, {})).toEqual([]);
  });

  it.each(['skuCode', 'size', 'color', 'price', 'stockQuantity'])(
    'rejects a null %s',
    (property) => {
      expect(failingProperties(UpdateSkuRequest, { [property]: null })).toEqual(
        [property],
      );
    },
  );

  it.each(['0.00', '100000000.00', 25])('rejects the price %p', (price) => {
    expect(failingProperties(UpdateSkuRequest, { price })).toEqual(['price']);
  });

  it('rejects a product id under the pipe options', () => {
    expect(
      failingProperties(
        UpdateSkuRequest,
        { productId: SKU.productId },
        PIPE_OPTIONS,
      ),
    ).toEqual(['productId']);
  });
});

describe.each([
  { type: CreateSkuRequest, body: SKU },
  { type: UpdateSkuRequest, body: {} },
])('$type.name text lengths', ({ type, body }) => {
  it.each(TEXT_MAXIMUMS)(
    'measures %s in code points, up to %i',
    (property, maximum) => {
      expect(
        failingProperties(type, {
          ...body,
          [property]: VARIATION_PAIR.repeat(maximum / 2),
        }),
      ).toEqual([]);
      expect(
        failingProperties(type, {
          ...body,
          [property]: VARIATION_PAIR.repeat(maximum / 2 + 1),
        }),
      ).toEqual([property]);
    },
  );
});

// stock_quantity is an int column.
describe.each([
  { type: CreateSkuRequest, body: SKU },
  { type: UpdateSkuRequest, body: {} },
])('$type.name stock quantity', ({ type, body }) => {
  it('accepts the largest int, 2147483647', () => {
    expect(
      failingProperties(type, { ...body, stockQuantity: 2147483647 }),
    ).toEqual([]);
  });

  it('rejects 2147483648, which the int column cannot hold', () => {
    expect(
      failingProperties(type, { ...body, stockQuantity: 2147483648 }),
    ).toEqual(['stockQuantity']);
  });
});

describe('SkuIdParams', () => {
  it('rejects a SKU id that is not a UUID', () => {
    expect(failingProperties(SkuIdParams, { skuId: 'not-a-uuid' })).toEqual([
      'skuId',
    ]);
  });
});
