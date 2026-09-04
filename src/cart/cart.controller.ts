import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CheckAbilities } from '../authorization/decorators/check-abilities.decorator';
import {
  CartItemCreateRequest,
  CartItemIdParams,
  CartItemUpdateRequest,
} from './cart.dto';
import { CartItemResponse, CartResponse, CartService } from './cart.service';

@Controller('me/cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @CheckAbilities({ action: 'manage', subject: 'Cart' })
  getMyCart(@CurrentUser() user: AuthenticatedUser): Promise<CartResponse> {
    return this.cart.getOrCreate(user);
  }

  @Post('items')
  @CheckAbilities({ action: 'manage', subject: 'Cart' })
  addCartItem(
    @Body() input: CartItemCreateRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CartItemResponse> {
    return this.cart.addItem(user, input);
  }

  @Patch('items/:itemId')
  @CheckAbilities({ action: 'manage', subject: 'Cart' })
  updateCartItem(
    @Param() { itemId }: CartItemIdParams,
    @Body() input: CartItemUpdateRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CartItemResponse> {
    return this.cart.updateItem(user, itemId, input);
  }

  @Delete('items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckAbilities({ action: 'manage', subject: 'Cart' })
  removeCartItem(
    @Param() { itemId }: CartItemIdParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.cart.removeItem(user, itemId);
  }
}
