import { Controller, Get, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListMyOrdersQuery } from './orders.dto';
import { OrderPageResponse, OrdersService } from './orders.service';

@Controller('me/orders')
export class MyOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  listMyOrders(
    @Query() query: ListMyOrdersQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderPageResponse> {
    return this.orders.listMine(query, user);
  }
}
