import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { REQUIRED_ABILITIES } from '../authorization/decorators/check-abilities.decorator';
import { AbilitiesGuard } from '../authorization/guards/abilities.guard';
import { CartController } from './cart.controller';
import type { CartService } from './cart.service';

type MethodName = keyof Pick<
  CartController,
  'getMyCart' | 'addCartItem' | 'updateCartItem' | 'removeCartItem'
>;

const methodTarget = (method: MethodName): object => {
  const target = Object.getOwnPropertyDescriptor(
    CartController.prototype,
    method,
  )?.value as object | undefined;

  if (!target) throw new Error(`Missing controller method: ${method}`);
  return target;
};

const metadataFor = (key: string, method: MethodName): unknown =>
  Reflect.getMetadata(key, methodTarget(method)) as unknown;

describe('CartController', () => {
  const cart = {
    getOrCreate: jest.fn(),
    addItem: jest.fn(),
    updateItem: jest.fn(),
    removeItem: jest.fn(),
  };
  const controller = new CartController(cart as unknown as CartService);
  const client: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'CLIENT',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates all four operations with the current client', async () => {
    const create = {
      skuId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      quantity: 1,
    };
    const update = { quantity: 2 };
    const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    await controller.getMyCart(client);
    await controller.addCartItem(create, client);
    await controller.updateCartItem({ itemId }, update, client);
    await controller.removeCartItem({ itemId }, client);

    expect(cart.getOrCreate).toHaveBeenCalledWith(client);
    expect(cart.addItem).toHaveBeenCalledWith(client, create);
    expect(cart.updateItem).toHaveBeenCalledWith(client, itemId, update);
    expect(cart.removeItem).toHaveBeenCalledWith(client, itemId);
  });

  it.each([
    ['getMyCart', '/', RequestMethod.GET],
    ['addCartItem', 'items', RequestMethod.POST],
    ['updateCartItem', 'items/:itemId', RequestMethod.PATCH],
    ['removeCartItem', 'items/:itemId', RequestMethod.DELETE],
  ] as const)(
    'routes %s at the contract path and method',
    (method, path, verb) => {
      expect(metadataFor(PATH_METADATA, method)).toBe(path);
      expect(metadataFor(METHOD_METADATA, method)).toBe(verb);
    },
  );

  it.each([
    'getMyCart',
    'addCartItem',
    'updateCartItem',
    'removeCartItem',
  ] as const)('requires the Cart ability on %s', (method) => {
    expect(metadataFor(REQUIRED_ABILITIES, method)).toEqual([
      { action: 'manage', subject: 'Cart' },
    ]);
    expect(metadataFor(GUARDS_METADATA, method)).toContain(AbilitiesGuard);
  });

  it('uses the controller prefix and returns no content on removal', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CartController)).toBe('me/cart');
    expect(metadataFor(HTTP_CODE_METADATA, 'removeCartItem')).toBe(204);
  });
});
