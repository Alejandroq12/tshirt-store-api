import type { UserRole } from '@prisma/client';

import type { AuthenticatedUser } from './authenticated-user';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  sid: string;
}

export interface RefreshTokenClaims {
  sub: string;
  sid: string;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

export type SessionSubject = Pick<AuthenticatedUser, 'id' | 'sessionId'>;
