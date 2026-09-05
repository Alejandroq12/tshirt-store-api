import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { REQUIRED_ABILITIES } from '../authorization/decorators/check-abilities.decorator';
import { AbilitiesGuard } from '../authorization/guards/abilities.guard';
import { MyOrdersController } from './my-orders.controller';
import { OrderStatusFilter } from './orders.dto';
import type { OrdersService } from './orders.service';

const methodTarget = (): object => {
  const target = Object.getOwnPropertyDescriptor(
    MyOrdersController.prototype,
    'listMyOrders',
  )?.value as object | undefined;

  if (!target) throw new Error('Missing controller method: listMyOrders');
  return target;
};

describe('MyOrdersController', () => {
  const orders = { listMine: jest.fn() };
  const controller = new MyOrdersController(orders as unknown as OrdersService);
  const client: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'CLIENT',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates the filters and current caller to the service', async () => {
    const query = {
      limit: 10,
      offset: 0,
      status: OrderStatusFilter.PAID,
      minPrice: '10.00',
    };

    await controller.listMyOrders(query, client);

    expect(orders.listMine).toHaveBeenCalledWith(query, client);
  });

  it('uses the contract route and requires the client history ability', () => {
    const target = methodTarget();

    expect(Reflect.getMetadata(PATH_METADATA, MyOrdersController)).toBe(
      'me/orders',
    );
    expect(Reflect.getMetadata(PATH_METADATA, target)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, target)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(REQUIRED_ABILITIES, target)).toEqual([
      { action: 'list', subject: 'Order' },
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, target)).toContain(
      AbilitiesGuard,
    );
  });
});
