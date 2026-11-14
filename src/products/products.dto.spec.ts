import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ListProductsQuery } from './products.dto';

type RequestClass = new () => object;

const failedProperties = (cls: RequestClass, value: object): string[] =>
  validateSync(plainToInstance(cls, value)).map(({ property }) => property);

describe('ListProductsQuery', () => {
  it('turns the query-string page values into integers', () => {
    const input = plainToInstance(ListProductsQuery, {
      limit: '20',
      offset: '5',
    });

    expect(validateSync(input)).toHaveLength(0);
    expect(input).toEqual({ limit: 20, offset: 5 });
  });

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
