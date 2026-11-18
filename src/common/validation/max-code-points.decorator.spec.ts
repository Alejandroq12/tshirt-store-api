import { plainToInstance } from 'class-transformer';
import { MaxLength, validateSync } from 'class-validator';

import { MaxCodePoints } from './max-code-points.decorator';

const VARIATION_SELECTOR = '️';
const SURROGATE_PAIR_EMOJI = '\u{1F455}';

class Named {
  @MaxCodePoints(4)
  value!: unknown;
}

const constraintsOf = (value: unknown) =>
  validateSync(plainToInstance(Named, { value })).map(
    ({ constraints }) => constraints,
  );

describe('MaxCodePoints', () => {
  it.each(['', 'abcd', 'ab'])('accepts %p, within 4 code points', (value) => {
    expect(constraintsOf(value)).toEqual([]);
  });

  it('rejects one code point over the maximum', () => {
    expect(constraintsOf('abcde')).toEqual([
      { maxCodePoints: 'value must be shorter than or equal to 4 characters' },
    ]);
  });

  it('counts a variation selector as its own code point', () => {
    const twoPairs = `A${VARIATION_SELECTOR}`.repeat(2);
    const threePairs = `A${VARIATION_SELECTOR}`.repeat(3);

    expect(constraintsOf(twoPairs)).toEqual([]);
    expect(constraintsOf(threePairs)).toHaveLength(1);
  });

  it('rejects the variation-selector string that MaxLength accepts', () => {
    class Measured {
      @MaxLength(4)
      value!: string;
    }
    const value = `A${VARIATION_SELECTOR}`.repeat(3);

    expect(validateSync(plainToInstance(Measured, { value }))).toEqual([]);
    expect(constraintsOf(value)).toHaveLength(1);
  });

  it('counts a surrogate-pair emoji as one code point', () => {
    expect(SURROGATE_PAIR_EMOJI).toHaveLength(2);
    expect(constraintsOf(SURROGATE_PAIR_EMOJI.repeat(4))).toEqual([]);
    expect(constraintsOf(SURROGATE_PAIR_EMOJI.repeat(5))).toHaveLength(1);
  });

  it.each([5, null, undefined, ['ab'], { length: 1 }])(
    'rejects %p, which is not a string',
    (value) => {
      expect(constraintsOf(value)).toEqual([
        {
          maxCodePoints: 'value must be shorter than or equal to 4 characters',
        },
      ]);
    },
  );
});
