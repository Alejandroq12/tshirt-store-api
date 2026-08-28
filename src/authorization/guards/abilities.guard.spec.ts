import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { CaslAbilityFactory } from '../casl-ability.factory';
import {
  REQUIRED_ABILITIES,
  type RequiredAbility,
} from '../decorators/check-abilities.decorator';
import { AbilitiesGuard } from './abilities.guard';

const MANAGER: AuthenticatedUser = {
  id: 'manager-id',
  role: 'MANAGER',
  sessionId: 'manager-session',
};
const CLIENT: AuthenticatedUser = {
  id: 'client-id',
  role: 'CLIENT',
  sessionId: 'client-session',
};

const contextFor = (user?: AuthenticatedUser): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user }) as unknown as Request,
    }),
  }) as unknown as ExecutionContext;

const reflectorFor = (abilities?: RequiredAbility[]): Reflector =>
  ({
    getAllAndOverride: (key: string) =>
      key === REQUIRED_ABILITIES ? abilities : undefined,
  }) as unknown as Reflector;

describe('AbilitiesGuard', () => {
  let factory: CaslAbilityFactory;

  beforeEach(() => {
    factory = new CaslAbilityFactory();
    factory.register((user, { can }) => {
      if (user.role === 'MANAGER') can('manage', 'Product');
      can('read', 'Product');
    });
  });

  it('lets a route through when it declares no abilities', () => {
    const guard = new AbilitiesGuard(reflectorFor(undefined), factory);

    expect(guard.canActivate(contextFor(CLIENT))).toBe(true);
  });

  it('allows an action the caller’s role permits', () => {
    const guard = new AbilitiesGuard(
      reflectorFor([{ action: 'create', subject: 'Product' }]),
      factory,
    );

    expect(guard.canActivate(contextFor(MANAGER))).toBe(true);
  });

  it('refuses an action the caller’s role does not permit', () => {
    const guard = new AbilitiesGuard(
      reflectorFor([{ action: 'create', subject: 'Product' }]),
      factory,
    );

    expect(() => guard.canActivate(contextFor(CLIENT))).toThrow(
      ForbiddenException,
    );
  });

  it('requires every declared ability, not just one of them', () => {
    const guard = new AbilitiesGuard(
      reflectorFor([
        { action: 'read', subject: 'Product' },
        { action: 'delete', subject: 'Product' },
      ]),
      factory,
    );

    expect(() => guard.canActivate(contextFor(CLIENT))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses an unauthenticated caller rather than building an empty ability', () => {
    const guard = new AbilitiesGuard(
      reflectorFor([{ action: 'read', subject: 'Product' }]),
      factory,
    );

    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('cannot decide ownership, and does not pretend to', () => {
    const ownership = new CaslAbilityFactory();
    ownership.register((user, { can }) =>
      can('read', 'Order', { clientId: user.id }),
    );

    const guard = new AbilitiesGuard(
      reflectorFor([{ action: 'read', subject: 'Order' }]),
      ownership,
    );

    expect(guard.canActivate(contextFor(CLIENT))).toBe(true);
  });
});
