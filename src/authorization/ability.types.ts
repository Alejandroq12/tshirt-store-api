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

// PaymentIntent names no table: a Payment Intent is stored on its order as
// stripe_payment_intent_id. It is a subject of its own so that the client-only
// createPaymentIntent does not borrow an Order ability granted for another
// operation.
export type AppSubjects =
  | 'all'
  | 'PaymentIntent'
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
