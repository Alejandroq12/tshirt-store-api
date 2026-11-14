import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ListMyOrdersQuery } from './orders.dto';

const PAGE = { limit: '10', offset: '0' };

describe('ListMyOrdersQuery', () => {
  it.each([
    '2026-09-01T00:00:00Z',
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00+05:30',
    '2026-09-01T00:00:00.5-03:00',
  ])(
    'accepts RFC 3339 bounds with Z, a numeric offset and fractional seconds: %s',
    (bound) => {
      const input = plainToInstance(ListMyOrdersQuery, {
        ...PAGE,
        from: bound,
        to: bound,
      });

      expect(validateSync(input)).toHaveLength(0);
    },
  );

  it.each(['2026-09-01', '2026-02-30T00:00:00Z'])(
    'rejects %s as a from or to bound',
    (bound) => {
      const input = plainToInstance(ListMyOrdersQuery, {
        ...PAGE,
        from: bound,
        to: bound,
      });

      expect(validateSync(input).map(({ property }) => property)).toEqual([
        'from',
        'to',
      ]);
    },
  );
});
