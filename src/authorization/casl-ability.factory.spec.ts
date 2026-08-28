import { subject } from '@casl/ability';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CaslAbilityFactory } from './casl-ability.factory';

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

describe('CaslAbilityFactory', () => {
  let factory: CaslAbilityFactory;

  beforeEach(() => {
    factory = new CaslAbilityFactory();
  });

  it('grants nothing until a feature registers rules', () => {
    const ability = factory.createForUser(MANAGER);

    expect(ability.can('read', 'Product')).toBe(false);
    expect(ability.can('manage', 'all')).toBe(false);
  });

  it('applies a registered contributor', () => {
    factory.register((user, { can }) => {
      if (user.role === 'MANAGER') can('manage', 'Product');
    });

    expect(factory.createForUser(MANAGER).can('update', 'Product')).toBe(true);
    expect(factory.createForUser(CLIENT).can('update', 'Product')).toBe(false);
  });

  it('combines contributors from different features', () => {
    factory.register((_user, { can }) => can('read', 'Product'));
    factory.register((_user, { can }) => can('read', 'Order'));

    const ability = factory.createForUser(CLIENT);

    expect(ability.can('read', 'Product')).toBe(true);
    expect(ability.can('read', 'Order')).toBe(true);
  });

  it('rebuilds per caller, so one user never inherits another’s rules', () => {
    factory.register((user, { can }) =>
      can('read', 'Order', { clientId: user.id }),
    );

    const ability = factory.createForUser(CLIENT);

    expect(
      ability.can('read', subject('Order', { clientId: 'client-id' } as never)),
    ).toBe(true);
    expect(
      ability.can(
        'read',
        subject('Order', { clientId: 'someone-else' } as never),
      ),
    ).toBe(false);
  });

  it('expresses conditions as Prisma where fragments', () => {
    factory.register((user, { can }) =>
      can('read', 'Order', { clientId: user.id }),
    );

    const [rule] = factory.createForUser(CLIENT).rules;

    expect(rule.conditions).toEqual({ clientId: 'client-id' });
  });
});
