import { Controller, Get, Query } from '@nestjs/common';

import type { SessionPrincipal } from '../auth/types/session-principal';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckAbilities } from '../authorization/decorators/check-abilities.decorator';
import { ListMyOrdersQuery } from './orders.dto';
import { OrdersService } from './services/orders.service';
import type { OrderPageResponse } from './types/orders.types';

@Controller('me/orders')
export class MyOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @CheckAbilities({ action: 'list', subject: 'Order' })
  listMyOrders(
    @Query() query: ListMyOrdersQuery,
    @CurrentUser() user: SessionPrincipal,
  ): Promise<OrderPageResponse> {
    return this.orders.listMine(query, user);
  }
}
