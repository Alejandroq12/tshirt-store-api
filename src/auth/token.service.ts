import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';

import type { EnvironmentVariables } from '../config/env.validation';
import type { AuthenticatedUser } from './authenticated-user';

const ALGORITHMS = ['HS256'] as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && Object.hasOwn(UserRole, value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

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

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async issueAccessToken(user: AuthenticatedUser): Promise<IssuedToken> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      role: user.role,
      sid: user.sessionId,
    };

    return this.sign(claims, 'JWT_ACCESS_SECRET', 'JWT_ACCESS_TTL');
  }

  async issueRefreshToken(session: SessionSubject): Promise<IssuedToken> {
    const claims: RefreshTokenClaims = {
      sub: session.id,
      sid: session.sessionId,
    };

    return this.sign(claims, 'JWT_REFRESH_SECRET', 'JWT_REFRESH_TTL');
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const claims = await this.verify<AccessTokenClaims>(
      token,
      'JWT_ACCESS_SECRET',
    );

    if (
      !isUuid(claims.sub) ||
      !isUuid(claims.sid) ||
      !isUserRole(claims.role)
    ) {
      throw new UnauthorizedException();
    }

    return { sub: claims.sub, role: claims.role, sid: claims.sid };
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const claims = await this.verify<RefreshTokenClaims>(
      token,
      'JWT_REFRESH_SECRET',
    );

    if (!isUuid(claims.sub) || !isUuid(claims.sid)) {
      throw new UnauthorizedException();
    }

    return { sub: claims.sub, sid: claims.sid };
  }

  private async sign(
    claims: object,
    secretKey: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
    ttlKey: 'JWT_ACCESS_TTL' | 'JWT_REFRESH_TTL',
  ): Promise<IssuedToken> {
    const token = await this.jwt.signAsync(claims, {
      secret: this.config.get(secretKey, { infer: true }),
      expiresIn: this.config.get(ttlKey, { infer: true }),
      algorithm: ALGORITHMS[0],
    });

    return { token, expiresAt: this.expiresAt(token) };
  }

  private async verify<T extends object>(
    token: string,
    secretKey: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
  ): Promise<T> {
    try {
      return await this.jwt.verifyAsync<T>(token, {
        secret: this.config.get(secretKey, { infer: true }),
        algorithms: [...ALGORITHMS],
      });
    } catch {
      throw new UnauthorizedException();
    }
  }

  private expiresAt(token: string): Date {
    const claims = this.jwt.decode<{ exp?: number } | null>(token);

    if (!claims || typeof claims.exp !== 'number') {
      throw new Error('signed token carries no exp claim');
    }

    return new Date(claims.exp * 1000);
  }
}
