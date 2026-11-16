import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { IntegerQuery } from './integer-query.decorator';

class PageQuery {
  @IntegerQuery()
  value!: number;
}

const parse = (value: unknown): PageQuery =>
  plainToInstance(PageQuery, { value });

describe('IntegerQuery', () => {
  it.each([
    ['0', 0],
    ['5', 5],
    ['05', 5],
    ['20', 20],
    ['007', 7],
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
    expect(validateSync(input).map(({ constraints }) => constraints)).toEqual([
      { isInt: 'value must be an integer number' },
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
