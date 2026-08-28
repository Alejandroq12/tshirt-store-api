import { randomUUID } from 'node:crypto';

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';

import type { EnvironmentVariables } from '../config/env.validation';
import { TokenService } from './token.service';

const ENVIRONMENT: Partial<EnvironmentVariables> = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_REFRESH_TTL: '30d',
};

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'CLIENT',
  sessionId: '22222222-2222-4222-8222-222222222222',
} as const;

describe('TokenService', () => {
  let tokens: TokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        TokenService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: keyof EnvironmentVariables) => ENVIRONMENT[key],
          },
        },
      ],
    }).compile();

    tokens = moduleRef.get(TokenService);
  });

  describe('access tokens', () => {
    it('carries the caller and their role', async () => {
      const { token } = await tokens.issueAccessToken(USER);

      await expect(tokens.verifyAccessToken(token)).resolves.toEqual({
        sub: USER.id,
        role: USER.role,
        sid: USER.sessionId,
      });
    });

    it('reports the expiry the token actually carries', async () => {
      const before = Date.now();
      const { token, expiresAt } = await tokens.issueAccessToken(USER);

      const exp = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      ) as { exp: number };

      expect(expiresAt.getTime()).toBe(exp.exp * 1000);
      expect(expiresAt.getTime() - before).toBeGreaterThan(14 * 60 * 1000);
      expect(expiresAt.getTime() - before).toBeLessThanOrEqual(
        15 * 60 * 1000 + 1000,
      );
    });
  });

  describe('the two secrets do not cross', () => {
    it('refuses a refresh token presented as an access token', async () => {
      const { token } = await tokens.issueRefreshToken(USER);

      await expect(tokens.verifyAccessToken(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('refuses an access token presented as a refresh token', async () => {
      const { token } = await tokens.issueAccessToken(USER);

      await expect(tokens.verifyRefreshToken(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('rejection', () => {
    it.each([
      ['a token signed with another key', null],
      ['a string that is not a JWT', 'not-a-token'],
      ['an empty string', ''],
    ])('refuses %s', async (_label, candidate) => {
      const token =
        candidate ??
        [
          Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
            'base64url',
          ),
          Buffer.from(
            JSON.stringify({ sub: USER.id, role: USER.role }),
          ).toString('base64url'),
          'forged-signature',
        ].join('.');

      await expect(tokens.verifyAccessToken(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('says nothing about why, so nothing is learned from the difference', async () => {
      const expired = await tokens.issueAccessToken(USER);

      const forInvalid = await tokens
        .verifyAccessToken('not-a-token')
        .catch((error: UnauthorizedException) => error.getResponse());
      const forWrongSecret = await tokens
        .verifyRefreshToken(expired.token)
        .catch((error: UnauthorizedException) => error.getResponse());

      expect(forInvalid).toEqual(forWrongSecret);
    });
  });

  describe('claims a correctly signed token cannot smuggle in', () => {
    const signed = (
      claims: object,
      options: {
        algorithm?: 'HS256' | 'HS512';
      } = {},
    ) =>
      sign(claims, ENVIRONMENT.JWT_ACCESS_SECRET!, {
        algorithm: options.algorithm ?? 'HS256',
        expiresIn: '15m',
      });

    it.each([
      [
        'a sub that is not a UUID',
        { sub: 'not-a-uuid', role: 'MANAGER', sid: USER.sessionId },
      ],
      ['an empty sub', { sub: '', role: 'MANAGER', sid: USER.sessionId }],
      ['a numeric sub', { sub: 123, role: 'MANAGER', sid: USER.sessionId }],
      [
        'a role outside the enum',
        { sub: USER.id, role: 'ADMIN', sid: USER.sessionId },
      ],
      [
        'a role that is not a string',
        { sub: USER.id, role: 7, sid: USER.sessionId },
      ],
      ['no role at all', { sub: USER.id, sid: USER.sessionId }],
      ['no session id', { sub: USER.id, role: 'MANAGER' }],
      [
        'a session id that is not a UUID',
        { sub: USER.id, role: 'MANAGER', sid: 'nope' },
      ],
    ])('refuses %s', async (_label, claims) => {
      await expect(tokens.verifyAccessToken(signed(claims))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('accepts the shape it issues', async () => {
      const claims = { sub: USER.id, role: USER.role, sid: USER.sessionId };

      await expect(tokens.verifyAccessToken(signed(claims))).resolves.toEqual(
        claims,
      );
    });

    it('refuses a token signed with an algorithm outside the allowlist', async () => {
      await expect(
        tokens.verifyAccessToken(
          signed(
            { sub: USER.id, role: USER.role, sid: USER.sessionId },
            { algorithm: 'HS512' },
          ),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('signs with HS256', async () => {
      const { token } = await tokens.issueAccessToken(USER);
      const header = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString(),
      ) as { alg: string };

      expect(header.alg).toBe('HS256');
    });

    it('refuses a sub that is not a UUID on a refresh token too', async () => {
      const refresh = sign(
        { sub: 'not-a-uuid' },
        ENVIRONMENT.JWT_REFRESH_SECRET!,
        {
          expiresIn: '30d',
        },
      );

      await expect(tokens.verifyRefreshToken(refresh)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('session identity', () => {
    it('gives two logins in the same second different refresh tokens', async () => {
      const [first, second] = await Promise.all([
        tokens.issueRefreshToken({ id: USER.id, sessionId: randomUUID() }),
        tokens.issueRefreshToken({ id: USER.id, sessionId: randomUUID() }),
      ]);

      expect(first.token).not.toBe(second.token);
    });

    it('gives two access tokens in the same second different values too', async () => {
      const [first, second] = await Promise.all([
        tokens.issueAccessToken({ ...USER, sessionId: randomUUID() }),
        tokens.issueAccessToken({ ...USER, sessionId: randomUUID() }),
      ]);

      expect(first.token).not.toBe(second.token);
    });

    it('round-trips the session id on an access token', async () => {
      const sessionId = randomUUID();
      const { token } = await tokens.issueAccessToken({ ...USER, sessionId });

      await expect(tokens.verifyAccessToken(token)).resolves.toEqual({
        sub: USER.id,
        role: USER.role,
        sid: sessionId,
      });
    });

    it('round-trips the session id on a refresh token', async () => {
      const sessionId = randomUUID();
      const { token } = await tokens.issueRefreshToken({
        id: USER.id,
        sessionId,
      });

      await expect(tokens.verifyRefreshToken(token)).resolves.toEqual({
        sub: USER.id,
        sid: sessionId,
      });
    });
  });
});
