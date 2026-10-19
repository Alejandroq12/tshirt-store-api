import type { UserRole } from '@prisma/client';

import type { SessionPrincipal } from './session-principal';

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

export type SessionSubject = Pick<SessionPrincipal, 'id' | 'sessionId'>;
