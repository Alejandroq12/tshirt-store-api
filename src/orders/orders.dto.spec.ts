import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ListMyOrdersQuery, ListOrdersQuery } from './orders.dto';

const PAGE = { limit: '10', offset: '0' };

// Number() reads all of these as integers; the contract's integer does not.
const NON_DECIMAL = ['0x10', '0b11', '1e1', '', '+5', ' 5', '5.0', '-1'];

const failedProperties = (
  cls: typeof ListOrdersQuery,
  value: object,
): string[] =>
  validateSync(plainToInstance(cls, value)).map(({ property }) => property);

describe.each([
  ['ListOrdersQuery', ListOrdersQuery],
  ['ListMyOrdersQuery', ListMyOrdersQuery],
])('%s page', (_name, cls) => {
  it.each([
    [
      { limit: '20', offset: '5' },
      { limit: 20, offset: 5 },
    ],
    [
      { limit: '05', offset: '00' },
      { limit: 5, offset: 0 },
    ],
  ])('turns %p into %p', (raw, expected) => {
    const input = plainToInstance(cls, raw);

    expect(validateSync(input)).toHaveLength(0);
    expect(input).toEqual(expected);
  });

  it.each(NON_DECIMAL)('rejects %p as a limit or an offset', (raw) => {
    expect(failedProperties(cls, { limit: raw, offset: raw })).toEqual([
      'limit',
      'offset',
    ]);
  });

  it('rejects a page value beyond 2^53 - 1 with one message each', () => {
    const errors = validateSync(
      plainToInstance(cls, {
        limit: '1000000000000000000000',
        offset: '9007199254740992',
      }),
    );

    expect(
      errors.map(({ property, constraints }) => [property, constraints]),
    ).toEqual([
      [
        'limit',
        { isSafeInteger: 'limit must not be greater than 9007199254740991' },
      ],
      [
        'offset',
        { isSafeInteger: 'offset must not be greater than 9007199254740991' },
      ],
    ]);
  });

  it.each([
    [{ limit: '0', offset: '0' }, 'limit'],
    [{ offset: '0' }, 'limit'],
    [{ limit: '20' }, 'offset'],
  ])('rejects an out-of-range or missing page value: %p', (raw, failed) => {
    expect(failedProperties(cls, raw)).toEqual([failed]);
  });
});

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

  it.each([
    '2026-09-01',
    '2026-02-30T00:00:00Z',
    '2026-09-01T00',
    '2026-09-01T00:00',
    '2026-09-01T00:00:00',
    '2026-09-01T00:00:00+0000',
    '2026-W36-2T00:00:00Z',
    '2026-244T00:00:00Z',
    '20260901T000000Z',
  ])('rejects %s as a from or to bound', (bound) => {
    const input = plainToInstance(ListMyOrdersQuery, {
      ...PAGE,
      from: bound,
      to: bound,
    });

    expect(validateSync(input).map(({ property }) => property)).toEqual([
      'from',
      'to',
    ]);
  });

  it.each([
    '0100-01-01T00:00:00+23:59',
    '9999-12-31T23:59:59.999Z',
    '9999-12-31T23:59:59+23:59',
  ])('accepts %s, whose UTC instant has a four-digit year', (bound) => {
    const input = plainToInstance(ListMyOrdersQuery, {
      ...PAGE,
      from: bound,
      to: bound,
    });

    expect(validateSync(input)).toHaveLength(0);
  });

  it.each([
    ['9999-12-31T23:59:59-23:59', '+010000-01-01T23:58:59.000Z'],
    ['9999-12-31T23:59:59.999-00:01', '+010000-01-01T00:00:59.999Z'],
  ])('rejects %s, which is %s in UTC, as a from or to bound', (bound, utc) => {
    expect(new Date(bound).toISOString()).toBe(utc);
    const input = plainToInstance(ListMyOrdersQuery, {
      ...PAGE,
      from: bound,
      to: bound,
    });

    expect(
      validateSync(input).map(({ property, constraints }) => [
        property,
        constraints,
      ]),
    ).toEqual(
      ['from', 'to'].map((property) => [
        property,
        {
          inFourDigitUtcYear: `${property} must fall within the years 0000 to 9999 in UTC.`,
        },
      ]),
    );
  });

  it('rejects a bound whose UTC instant falls before year 0000', () => {
    const bound = '0000-01-01T00:00:00+00:01';
    expect(new Date(bound).toISOString()).toBe('-000001-12-31T23:59:00.000Z');

    const [from] = validateSync(
      plainToInstance(ListMyOrdersQuery, { ...PAGE, from: bound }),
    );

    expect(from.constraints).toHaveProperty(
      'inFourDigitUtcYear',
      'from must fall within the years 0000 to 9999 in UTC.',
    );
  });
});
