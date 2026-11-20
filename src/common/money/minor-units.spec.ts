import { Prisma } from '@prisma/client';

import { MAX_AMOUNT } from './max-amount';
import { fromMinorUnits, toMinorUnits } from './minor-units';

describe('minor units', () => {
  it.each([
    ['0.00', 0],
    ['0.01', 1],
    ['19.99', 1999],
    ['39.98', 3998],
    [MAX_AMOUNT, 9999999999],
  ])('converts %s to %i minor units', (amount, minorUnits) => {
    expect(toMinorUnits(new Prisma.Decimal(amount))).toBe(minorUnits);
  });

  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [5000, '50.00'],
    [9999999999, MAX_AMOUNT],
  ])('converts %i minor units back to %s', (minorUnits, amount) => {
    expect(fromMinorUnits(minorUnits).toFixed(2)).toBe(amount);
  });

  it('round-trips an amount without floating-point drift', () => {
    const amount = new Prisma.Decimal('0.29');

    expect(fromMinorUnits(toMinorUnits(amount)).equals(amount)).toBe(true);
  });
});
