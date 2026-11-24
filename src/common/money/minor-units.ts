import { Prisma } from '@prisma/client';

// Stripe counts money in the currency's minor unit, cents for USD. Every
// amount here has two decimal places, so the conversion is a factor of 100.
// The boot refuses a zero- or three-decimal STORE_CURRENCY (see
// src/config/env.validation.ts), so no other exponent reaches this code.
const MINOR_UNITS_PER_UNIT = 100;

// A decimal(10,2) amount holds at most 9999999999 minor units, well inside
// the integers a JavaScript number keeps exact.
export const toMinorUnits = (amount: Prisma.Decimal): number =>
  amount.mul(MINOR_UNITS_PER_UNIT).toNumber();

export const fromMinorUnits = (minorUnits: number): Prisma.Decimal =>
  new Prisma.Decimal(minorUnits).div(MINOR_UNITS_PER_UNIT);
