import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CreateProductRequest,
  LikeUpdateRequest,
  ListProductsQuery,
  ProductIdParams,
  ProductStatus,
  UpdateProductRequest,
} from './products.dto';

type RequestClass = new () => object;

const CATEGORY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATE = { categoryId: CATEGORY_ID, name: 'Classic Crew' };

const failedProperties = (cls: RequestClass, value: object): string[] =>
  validateSync(plainToInstance(cls, value)).map(({ property }) => property);

// validator.js isLength counts each pair as one character; the contract's
// minLength and maxLength and the varchar(200) column count two code points.
const VARIATION_PAIR = 'A\uFE0F';

describe('ListProductsQuery', () => {
  it('turns the query-string page values into integers', () => {
    const input = plainToInstance(ListProductsQuery, {
      limit: '20',
      offset: '5',
    });

    expect(validateSync(input)).toHaveLength(0);
    expect(input).toEqual({ limit: 20, offset: 5 });
  });

  it('reads a leading zero as a decimal digit', () => {
    const input = plainToInstance(ListProductsQuery, {
      limit: '05',
      offset: '00',
    });

    expect(validateSync(input)).toHaveLength(0);
    expect(input).toEqual({ limit: 5, offset: 0 });
  });

  // Number() reads all of these as integers; the contract's integer does not.
  it.each(['0x10', '0b11', '1e1', '', '+5', ' 5', '5.0', '-1'])(
    'rejects %p as a limit or an offset',
    (raw) => {
      expect(
        failedProperties(ListProductsQuery, { limit: raw, offset: raw }),
      ).toEqual(['limit', 'offset']);
    },
  );

  it('accepts a category slug', () => {
    expect(
      failedProperties(ListProductsQuery, {
        limit: '20',
        offset: '0',
        category: 't-shirts',
      }),
    ).toEqual([]);
  });

  it.each([
    [{ limit: '0', offset: '0' }, 'limit'],
    [{ limit: '1.5', offset: '0' }, 'limit'],
    [{ limit: 'abc', offset: '0' }, 'limit'],
    [{ offset: '0' }, 'limit'],
    [{ limit: '20', offset: '-1' }, 'offset'],
    [{ limit: '20', offset: '2.5' }, 'offset'],
    [{ limit: '20' }, 'offset'],
    [{ limit: '20', offset: '0', category: '' }, 'category'],
  ])('rejects an invalid catalogue query: %p', (value, property) => {
    expect(failedProperties(ListProductsQuery, value)).toEqual([property]);
  });
});

describe('LikeUpdateRequest', () => {
  it.each([true, false])('accepts liked %p', (liked) => {
    expect(failedProperties(LikeUpdateRequest, { liked })).toEqual([]);
  });

  // The body is JSON, so only a real boolean is a valid liked state.
  it.each([{ liked: 'true' }, { liked: 1 }, { liked: null }, {}])(
    'rejects a liked state that is not a boolean: %p',
    (value) => {
      expect(failedProperties(LikeUpdateRequest, value)).toEqual(['liked']);
    },
  );
});

describe('CreateProductRequest', () => {
  it.each([
    { ...CREATE, name: 'x'.repeat(200) },
    { ...CREATE, description: null },
    CREATE,
  ])('accepts a valid product: %p', (value) => {
    expect(failedProperties(CreateProductRequest, value)).toEqual([]);
  });

  it.each([
    [{ ...CREATE, name: 'x'.repeat(201) }, 'name'],
    [{ ...CREATE, name: '' }, 'name'],
    [{ ...CREATE, categoryId: 'not-a-uuid' }, 'categoryId'],
    [{ ...CREATE, description: 5 }, 'description'],
  ])('rejects an invalid product: %p', (value, property) => {
    expect(failedProperties(CreateProductRequest, value)).toEqual([property]);
  });
});

describe.each([
  { type: CreateProductRequest, body: CREATE },
  { type: UpdateProductRequest, body: {} },
])('$type.name name length', ({ type, body }) => {
  it('measures it in code points, accepting 200 and rejecting 202', () => {
    expect(
      failedProperties(type, { ...body, name: VARIATION_PAIR.repeat(100) }),
    ).toEqual([]);
    expect(
      failedProperties(type, { ...body, name: VARIATION_PAIR.repeat(101) }),
    ).toEqual(['name']);
  });

  it('accepts one code point and rejects an empty name', () => {
    expect(failedProperties(type, { ...body, name: 'x' })).toEqual([]);
    expect(failedProperties(type, { ...body, name: '' })).toEqual(['name']);
  });
});

describe('UpdateProductRequest', () => {
  it('accepts a null description, which clears it', () => {
    expect(
      failedProperties(UpdateProductRequest, { description: null }),
    ).toEqual([]);
  });

  it.each(Object.values(ProductStatus))('accepts the %s status', (status) => {
    expect(failedProperties(UpdateProductRequest, { status })).toEqual([]);
  });

  // Only description is nullable; a null on any other field is not a skip.
  it.each([
    [{ categoryId: null }, 'categoryId'],
    [{ name: null }, 'name'],
    [{ status: null }, 'status'],
    [{ status: 'ACTIVE' }, 'status'],
    [{ status: 'deleted' }, 'status'],
  ])('rejects an invalid update: %p', (value, property) => {
    expect(failedProperties(UpdateProductRequest, value)).toEqual([property]);
  });
});

describe('ProductIdParams', () => {
  it('requires a UUID', () => {
    expect(
      failedProperties(ProductIdParams, { productId: PRODUCT_ID }),
    ).toEqual([]);
    expect(
      failedProperties(ProductIdParams, { productId: 'not-a-uuid' }),
    ).toEqual(['productId']);
  });
});
