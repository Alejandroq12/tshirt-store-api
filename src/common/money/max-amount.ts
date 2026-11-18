import type { Prisma } from '@prisma/client';

// The largest decimal(10,2) value, and so the largest amount the contract's
// Amount pattern ^(0|[1-9]\d{0,7})\.\d{2}$ can carry.
export const MAX_AMOUNT = '99999999.99';

export const exceedsMaxAmount = (amount: Prisma.Decimal): boolean =>
  amount.greaterThan(MAX_AMOUNT);
