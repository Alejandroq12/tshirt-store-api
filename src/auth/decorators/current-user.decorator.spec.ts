import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import type { SessionPrincipal } from '../types/session-principal';
import { CurrentUser, resolveCurrentUser } from './current-user.decorator';

const USER: SessionPrincipal = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'CLIENT',
  sessionId: '22222222-2222-4222-8222-222222222222',
};

describe('resolveCurrentUser', () => {
  it('returns the caller the guard resolved', () => {
    expect(resolveCurrentUser({ user: USER })).toEqual(USER);
  });

  it('refuses rather than returning undefined on a guarded route', () => {
    expect(() => resolveCurrentUser({ user: undefined })).toThrow(
      UnauthorizedException,
    );
  });

  it('allows an absent caller where the route says anonymous is expected', () => {
    expect(
      resolveCurrentUser({ user: undefined }, { optional: true }),
    ).toBeUndefined();
  });

  it('still returns the caller on an optional route when one is present', () => {
    expect(resolveCurrentUser({ user: USER }, { optional: true })).toEqual(
      USER,
    );
  });
});

describe('CurrentUser', () => {
  type ParamFactory = (
    data: unknown,
    context: ExecutionContext,
  ) => SessionPrincipal | undefined;

  class Routes {
    guarded(@CurrentUser() _user: SessionPrincipal): void {}

    optional(@CurrentUser({ optional: true }) _user?: SessionPrincipal): void {}
  }

  // Nest stores each parameter decorator's factory and its argument on the
  // handler; this calls them the way the router does for a request.
  const resolve = (
    handler: keyof Routes,
    user?: SessionPrincipal,
  ): SessionPrincipal | undefined => {
    const metadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      Routes,
      handler,
    ) as Record<string, { data: unknown; factory: ParamFactory }>;
    const [{ data, factory }] = Object.values(metadata);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;

    return factory(data, context);
  };

  it('reads the caller from the HTTP request', () => {
    expect(resolve('guarded', USER)).toEqual(USER);
  });

  it('refuses a request with no caller on a guarded parameter', () => {
    expect(() => resolve('guarded')).toThrow(UnauthorizedException);
  });

  it('passes { optional: true } through, so an anonymous caller is undefined', () => {
    expect(resolve('optional')).toBeUndefined();
  });
});
