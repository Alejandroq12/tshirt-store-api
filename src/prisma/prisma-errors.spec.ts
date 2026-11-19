import { Prisma } from '@prisma/client';

import { isUniqueViolation } from './prisma-errors';

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('database constraint failed', {
    code,
    clientVersion: '6.19.3',
  });

describe('isUniqueViolation', () => {
  it('recognises a P2002 known request error', () => {
    expect(isUniqueViolation(knownError('P2002'))).toBe(true);
  });

  it('rejects a known request error with another code', () => {
    expect(isUniqueViolation(knownError('P2025'))).toBe(false);
  });

  it('rejects a plain Error, even one that carries the code', () => {
    expect(
      isUniqueViolation(Object.assign(new Error('failed'), { code: 'P2002' })),
    ).toBe(false);
  });

  it.each([undefined, null, 'P2002', { code: 'P2002' }])(
    'rejects %p, which is not an error',
    (value) => {
      expect(isUniqueViolation(value)).toBe(false);
    },
  );
});
