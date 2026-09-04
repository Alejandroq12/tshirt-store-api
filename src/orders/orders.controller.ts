import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CheckAbilities } from '../authorization/decorators/check-abilities.decorator';
import { API_PREFIX } from '../bootstrap';
import {
  ListOrdersQuery,
  OrderIdParams,
  OrderStatusUpdateRequest,
} from './orders.dto';
import {
  OrderPageResponse,
  OrderResponse,
  OrdersService,
} from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Order' })
  async createOrderFromCart(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrderResponse> {
    const order = await this.orders.createFromCart(user);
    response.location(`/${API_PREFIX}/orders/${order.id}`);
    return order;
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Order' })
  listOrders(@Query() query: ListOrdersQuery): Promise<OrderPageResponse> {
    return this.orders.list(query);
  }

  @Get(':orderId')
  getOrder(
    @Param() { orderId }: OrderIdParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderResponse> {
    return this.orders.get(orderId, user);
  }

  @Patch(':orderId/status')
  @CheckAbilities({ action: 'update', subject: 'Order' })
  updateOrderStatus(
    @Param() { orderId }: OrderIdParams,
    @Body() input: OrderStatusUpdateRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderResponse> {
    return this.orders.updateStatus(orderId, input, user);
  }
}
