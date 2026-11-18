import { plainToInstance } from 'class-transformer';
import { Min, validateSync } from 'class-validator';

import { IntegerQuery } from './integer-query.decorator';

class PageQuery {
  @IntegerQuery()
  value!: number;
}

class MinimumPageQuery {
  @IntegerQuery()
  @Min(1)
  value!: number;
}

const parse = (value: unknown): PageQuery =>
  plainToInstance(PageQuery, { value });

const constraints = (input: object) =>
  validateSync(input).map(({ constraints }) => constraints);

describe('IntegerQuery', () => {
  it.each([
    ['0', 0],
    ['5', 5],
    ['05', 5],
    ['20', 20],
    ['007', 7],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('converts the decimal string %p to %p', (raw, expected) => {
    const input = parse(raw);

    expect(validateSync(input)).toHaveLength(0);
    expect(input.value).toBe(expected);
  });

  it.each([
    '0x10',
    '0b11',
    '0o7',
    '1e1',
    '',
    ' ',
    '+5',
    ' 5',
    '5 ',
    '5.0',
    '1.5',
    '-1',
    'abc',
    'Infinity',
  ])('leaves %p unconverted and rejects it as an integer', (raw) => {
    const input = parse(raw);

    expect(input.value).toBe(raw);
    expect(constraints(input)).toEqual([
      { isSafeInteger: 'value must be an integer number' },
    ]);
  });

  it.each([
    '9007199254740992',
    '9007199254740993',
    '9223372036854775808',
    '1000000000000000000000',
    '9'.repeat(400),
  ])('rejects %p, which no Number holds exactly, as too large', (raw) => {
    expect(constraints(parse(raw))).toEqual([
      { isSafeInteger: 'value must not be greater than 9007199254740991' },
    ]);
  });

  it('reports a too-large value once, not also as below a sibling minimum', () => {
    expect(
      constraints(
        plainToInstance(MinimumPageQuery, { value: '1000000000000000000000' }),
      ),
    ).toEqual([
      { isSafeInteger: 'value must not be greater than 9007199254740991' },
    ]);
  });

  it.each([[undefined], [null], [['1', '2']]])(
    'rejects %p, which is not a single query value',
    (raw) => {
      expect(validateSync(parse(raw)).map(({ property }) => property)).toEqual([
        'value',
      ]);
    },
  );
});
