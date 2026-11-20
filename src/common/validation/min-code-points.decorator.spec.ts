import { plainToInstance } from 'class-transformer';
import { MinLength, validateSync } from 'class-validator';

import { MinCodePoints } from './min-code-points.decorator';

const VARIATION_SELECTOR = '️';
const SURROGATE_PAIR_EMOJI = '\u{1F455}';

class Named {
  @MinCodePoints(4)
  value!: unknown;
}

const constraintsOf = (value: unknown) =>
  validateSync(plainToInstance(Named, { value })).map(
    ({ constraints }) => constraints,
  );

describe('MinCodePoints', () => {
  it.each(['abcd', 'abcde', 'x'.repeat(100)])(
    'accepts %p, at least 4 code points',
    (value) => {
      expect(constraintsOf(value)).toEqual([]);
    },
  );

  it.each(['', 'abc'])('rejects %p, under 4 code points', (value) => {
    expect(constraintsOf(value)).toEqual([
      { minCodePoints: 'value must be longer than or equal to 4 characters' },
    ]);
  });

  it('counts a variation selector as its own code point', () => {
    const twoPairs = `A${VARIATION_SELECTOR}`.repeat(2);
    const oneAndAHalfPairs = `A${VARIATION_SELECTOR}A`;

    expect(constraintsOf(twoPairs)).toEqual([]);
    expect(constraintsOf(oneAndAHalfPairs)).toHaveLength(1);
  });

  it('accepts the variation-selector string that MinLength rejects', () => {
    class Measured {
      @MinLength(4)
      value!: string;
    }
    const value = `A${VARIATION_SELECTOR}`.repeat(2);

    expect(validateSync(plainToInstance(Measured, { value }))).toHaveLength(1);
    expect(constraintsOf(value)).toEqual([]);
  });

  it('counts a surrogate-pair emoji as one code point', () => {
    expect(SURROGATE_PAIR_EMOJI.repeat(3)).toHaveLength(6);
    expect(constraintsOf(SURROGATE_PAIR_EMOJI.repeat(4))).toEqual([]);
    expect(constraintsOf(SURROGATE_PAIR_EMOJI.repeat(3))).toHaveLength(1);
  });

  it.each([5, null, undefined, ['abcd'], { length: 4 }])(
    'rejects %p, which is not a string',
    (value) => {
      expect(constraintsOf(value)).toEqual([
        {
          minCodePoints: 'value must be longer than or equal to 4 characters',
        },
      ]);
    },
  );
});
