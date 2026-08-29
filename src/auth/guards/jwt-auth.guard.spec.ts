import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthService } from '../auth.service';
import { IS_OPTIONAL_AUTH } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC } from '../decorators/public.decorator';
import type { TokenService } from '../token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const CLAIMS = {
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'CLIENT',
  sid: '22222222-2222-4222-8222-222222222222',
} as const;

const contextFor = (headers: Record<string, string> = {}) => {
  const request = { headers } as unknown as Request;

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
};

const reflectorFor = (metadata: Record<string, boolean>): Reflector =>
  ({
    getAllAndOverride: (key: string) => metadata[key],
  }) as unknown as Reflector;

describe('JwtAuthGuard', () => {
  const verifyAccessToken = jest.fn();
  const tokens = { verifyAccessToken } as unknown as TokenService;
  const isSessionActive = jest.fn();
  const auth = { isSessionActive } as unknown as AuthService;
  const guardFor = (metadata: Record<string, boolean> = {}) =>
    new JwtAuthGuard(reflectorFor(metadata), tokens, auth);

  beforeEach(() => {
    verifyAccessToken.mockReset();
    verifyAccessToken.mockResolvedValue(CLAIMS);
    isSessionActive.mockReset();
    isSessionActive.mockResolvedValue(true);
  });

  describe('a route nobody marked', () => {
    it('is protected, which is the default that matters', async () => {
      const guard = guardFor();
      const { context } = contextFor();

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('resolves the caller from a valid token', async () => {
      const guard = guardFor();
      const { context, request } = contextFor({
        authorization: 'Bearer valid',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({
        id: CLAIMS.sub,
        role: CLAIMS.role,
        sessionId: CLAIMS.sid,
      });
      expect(isSessionActive).toHaveBeenCalledWith(request.user);
    });

    it('rejects a valid token whose session was revoked', async () => {
      isSessionActive.mockResolvedValue(false);
      const { context } = contextFor({ authorization: 'Bearer valid' });

      await expect(guardFor().canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token that does not verify', async () => {
      verifyAccessToken.mockRejectedValue(new UnauthorizedException());
      const guard = guardFor();
      const { context } = contextFor({ authorization: 'Bearer forged' });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('@Public', () => {
    it('lets an anonymous caller through', async () => {
      const guard = guardFor({ [IS_PUBLIC]: true });
      const { context } = contextFor();

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('attaches no user even when a token is sent', async () => {
      const guard = guardFor({ [IS_PUBLIC]: true });
      const { context, request } = contextFor({
        authorization: 'Bearer valid',
      });

      await guard.canActivate(context);

      expect(request.user).toBeUndefined();
      expect(verifyAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('@OptionalAuth', () => {
    const guardWithOptional = () => guardFor({ [IS_OPTIONAL_AUTH]: true });

    it('serves an anonymous caller with no user attached', async () => {
      const { context, request } = contextFor();

      await expect(guardWithOptional().canActivate(context)).resolves.toBe(
        true,
      );
      expect(request.user).toBeUndefined();
    });

    it('attaches the caller when a valid token is sent', async () => {
      const { context, request } = contextFor({
        authorization: 'Bearer valid',
      });

      await guardWithOptional().canActivate(context);

      expect(request.user).toEqual({
        id: CLAIMS.sub,
        role: CLAIMS.role,
        sessionId: CLAIMS.sid,
      });
    });

    it('still rejects a token that does not verify', async () => {
      verifyAccessToken.mockRejectedValue(new UnauthorizedException());
      const { context } = contextFor({ authorization: 'Bearer forged' });

      await expect(guardWithOptional().canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('the Authorization header', () => {
    it.each([
      ['a scheme that is not Bearer', 'Basic dXNlcjpwYXNz'],
      ['Bearer with nothing after it', 'Bearer'],
      ['Bearer with an empty value', 'Bearer   '],
    ])('ignores %s', async (_label, header) => {
      const guard = guardFor();
      const { context } = contextFor({ authorization: header });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(verifyAccessToken).not.toHaveBeenCalled();
    });

    it('accepts the scheme case-insensitively, as RFC 9110 requires', async () => {
      const guard = guardFor();
      const { context } = contextFor({ authorization: 'bearer valid' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });
});
