import { UnauthorizedException } from '@nestjs/common';

import type { AuthenticatedUser } from '../authenticated-user';
import { resolveCurrentUser } from './current-user.decorator';

const USER: AuthenticatedUser = {
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
