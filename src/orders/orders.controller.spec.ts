import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { validate } from 'class-validator';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { REQUIRED_ABILITIES } from '../authorization/decorators/check-abilities.decorator';
import { AbilitiesGuard } from '../authorization/guards/abilities.guard';
import { OrdersController } from './orders.controller';
import {
  ListOrdersQuery,
  OrderStatusUpdate,
  OrderStatusUpdateRequest,
} from './orders.dto';
import type { OrdersService } from './orders.service';

type MethodName = keyof Pick<
  OrdersController,
  'createOrderFromCart' | 'getOrder' | 'listOrders' | 'updateOrderStatus'
>;

const methodTarget = (method: MethodName): object => {
  const target = Object.getOwnPropertyDescriptor(
    OrdersController.prototype,
    method,
  )?.value as object | undefined;

  if (!target) throw new Error(`Missing controller method: ${method}`);
  return target;
};

const metadataFor = (key: string, method: MethodName): unknown =>
  Reflect.getMetadata(key, methodTarget(method)) as unknown;

describe('OrdersController', () => {
  const orders = {
    createFromCart: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    updateStatus: jest.fn(),
  };
  const controller = new OrdersController(orders as unknown as OrdersService);
  const client: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'CLIENT',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };
  const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeEach(() => {
    jest.clearAllMocks();
    orders.createFromCart.mockResolvedValue({ id: orderId });
  });

  it('delegates all four operations and sets the creation location', async () => {
    const query = { limit: 20, offset: 0 };
    const update = { status: OrderStatusUpdate.PROCESSING };
    const response = { location: jest.fn() };

    await controller.createOrderFromCart(client, response as never);
    await controller.getOrder({ orderId }, client);
    await controller.listOrders(query);
    await controller.updateOrderStatus({ orderId }, update, client);

    expect(orders.createFromCart).toHaveBeenCalledWith(client);
    expect(response.location).toHaveBeenCalledWith(`/v1/orders/${orderId}`);
    expect(orders.get).toHaveBeenCalledWith(orderId, client);
    expect(orders.list).toHaveBeenCalledWith(query);
    expect(orders.updateStatus).toHaveBeenCalledWith(orderId, update, client);
  });

  it.each([
    ['createOrderFromCart', '/', RequestMethod.POST],
    ['listOrders', '/', RequestMethod.GET],
    ['getOrder', ':orderId', RequestMethod.GET],
    ['updateOrderStatus', ':orderId/status', RequestMethod.PATCH],
  ] as const)(
    'routes %s at the contract path and method',
    (method, path, verb) => {
      expect(metadataFor(PATH_METADATA, method)).toBe(path);
      expect(metadataFor(METHOD_METADATA, method)).toBe(verb);
    },
  );

  it.each([
    ['createOrderFromCart', { action: 'create', subject: 'Order' }],
    ['listOrders', { action: 'read', subject: 'Order' }],
    ['updateOrderStatus', { action: 'update', subject: 'Order' }],
  ] as const)('requires the exact Order ability on %s', (method, ability) => {
    expect(metadataFor(REQUIRED_ABILITIES, method)).toEqual([ability]);
    expect(metadataFor(GUARDS_METADATA, method)).toContain(AbilitiesGuard);
  });

  it('does not expose a CASL 403 path on getOrder', () => {
    expect(metadataFor(REQUIRED_ABILITIES, 'getOrder')).toBeUndefined();
    expect(metadataFor(GUARDS_METADATA, 'getOrder')).toBeUndefined();
  });

  it('uses the orders controller prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, OrdersController)).toBe('orders');
  });

  it('keeps paid unavailable to the HTTP status update', async () => {
    const paid = Object.assign(new OrderStatusUpdateRequest(), {
      status: 'paid',
    });
    const processing = Object.assign(new OrderStatusUpdateRequest(), {
      status: OrderStatusUpdate.PROCESSING,
    });

    await expect(validate(paid)).resolves.not.toHaveLength(0);
    await expect(validate(processing)).resolves.toHaveLength(0);
  });

  it('requires both pagination values', async () => {
    const errors = await validate(new ListOrdersQuery());

    expect(errors.map(({ property }) => property).sort()).toEqual([
      'limit',
      'offset',
    ]);
  });
});
