import type { AbilityBuilder } from '@casl/ability';
import type { PrismaAbility, Subjects } from '@casl/prisma';
import type {
  Cart,
  CartItem,
  Category,
  Order,
  OrderItem,
  PasswordResetToken,
  PaymentLink,
  Product,
  ProductImage,
  ProductLike,
  ProductSku,
  Session,
  SkuImageAssignment,
  StockNotification,
  StripeWebhookEvent,
  User,
} from '@prisma/client';

import type { SessionPrincipal } from '../auth/types/session-principal';

export type AppAction =
  'manage' | 'create' | 'read' | 'list' | 'update' | 'delete';

export type AppSubjects =
  | 'all'
  | Subjects<{
      User: User;
      Session: Session;
      PasswordResetToken: PasswordResetToken;
      Category: Category;
      Product: Product;
      ProductImage: ProductImage;
      ProductSku: ProductSku;
      SkuImageAssignment: SkuImageAssignment;
      ProductLike: ProductLike;
      Cart: Cart;
      CartItem: CartItem;
      Order: Order;
      OrderItem: OrderItem;
      PaymentLink: PaymentLink;
      StripeWebhookEvent: StripeWebhookEvent;
      StockNotification: StockNotification;
    }>;

export type AppAbility = PrismaAbility<[AppAction, AppSubjects]>;

export type AbilityRuleContributor = (
  user: SessionPrincipal,
  builder: AbilityBuilder<AppAbility>,
) => void;
