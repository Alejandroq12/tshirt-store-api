import type { UserRole } from '@prisma/client';

export interface SessionPrincipal {
  id: string;
  role: UserRole;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionPrincipal;
    }
  }
}
