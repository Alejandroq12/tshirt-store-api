import { Prisma } from '@prisma/client';

// Prisma reports a write that breaks a unique constraint or index as a known
// request error with code P2002.
export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';
