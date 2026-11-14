import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import type { SessionPrincipal } from '../../auth/types/session-principal';
import type { EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { CartItemCreateRequest, CartItemUpdateRequest } from '../cart.dto';
import type { CartItemResponse, CartResponse } from '../types/cart.types';

const CART_ITEM_SELECT = {
  id: true,
  skuId: true,
  quantity: true,
  sku: {
    select: {
      productId: true,
      skuCode: true,
      size: true,
      color: true,
      price: true,
      product: { select: { name: true } },
    },
  },
} satisfies Prisma.CartItemSelect;

const CART_SELECT = {
  id: true,
  updatedAt: true,
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: CART_ITEM_SELECT,
  },
} satisfies Prisma.CartSelect;

type CartRecord = Prisma.CartGetPayload<{ select: typeof CART_SELECT }>;
type CartItemRecord = Prisma.CartItemGetPayload<{
  select: typeof CART_ITEM_SELECT;
}>;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class CartService {
  private readonly currency: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.currency = config.get('STORE_CURRENCY', { infer: true });
  }

  async getOrCreate(user: SessionPrincipal): Promise<CartResponse> {
    const cartId = await this.getOrCreateCartId(user.id);
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      select: CART_SELECT,
    });

    return this.cartResponse(cart);
  }

  async addItem(
    user: SessionPrincipal,
    input: CartItemCreateRequest,
  ): Promise<CartItemResponse> {
    const sku = await this.prisma.productSku.findFirst({
      where: {
        id: input.skuId,
        product: { isActive: true, deletedAt: null },
      },
      select: { id: true },
    });

    if (!sku) throw new NotFoundException();

    const cartId = await this.getOrCreateCartId(user.id);
    const item = await this.prisma.cartItem.create({
      data: { cartId, skuId: input.skuId, quantity: input.quantity },
      select: CART_ITEM_SELECT,
    });

    return this.cartItemResponse(item);
  }

  async updateItem(
    user: SessionPrincipal,
    itemId: string,
    input: CartItemUpdateRequest,
  ): Promise<CartItemResponse> {
    const existing = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { clientId: user.id } },
      select: { id: true },
    });

    if (!existing) throw new NotFoundException();

    const item = await this.prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: input.quantity },
      select: CART_ITEM_SELECT,
    });

    return this.cartItemResponse(item);
  }

  async removeItem(user: SessionPrincipal, itemId: string): Promise<void> {
    const result = await this.prisma.cartItem.deleteMany({
      where: { id: itemId, cart: { clientId: user.id } },
    });

    if (result.count !== 1) throw new NotFoundException();
  }

  private async getOrCreateCartId(clientId: string): Promise<string> {
    try {
      const cart = await this.prisma.cart.upsert({
        where: { clientId },
        create: { clientId },
        update: {},
        select: { id: true },
      });
      return cart.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const cart = await this.prisma.cart.findUniqueOrThrow({
        where: { clientId },
        select: { id: true },
      });
      return cart.id;
    }
  }

  private cartResponse(cart: CartRecord): CartResponse {
    const subtotal = cart.items.reduce(
      (total, item) => total.add(item.sku.price.mul(item.quantity)),
      new Prisma.Decimal('0.00'),
    );

    return {
      id: cart.id,
      items: cart.items.map((item) => this.cartItemResponse(item)),
      subtotalAmount: subtotal.toFixed(2),
      currency: this.currency,
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  private cartItemResponse(item: CartItemRecord): CartItemResponse {
    return {
      id: item.id,
      skuId: item.skuId,
      productId: item.sku.productId,
      productName: item.sku.product.name,
      skuCode: item.sku.skuCode,
      size: item.sku.size,
      color: item.sku.color,
      quantity: item.quantity,
      unitPrice: item.sku.price.toFixed(2),
      lineTotal: item.sku.price.mul(item.quantity).toFixed(2),
    };
  }
}
