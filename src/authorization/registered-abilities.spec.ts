import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CartModule } from '../cart/cart.module';
import { ImagesModule } from '../images/images.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { StripeClient } from '../payments/stripe.client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsModule } from '../products/products.module';
import { S3StorageService } from '../storage/s3-storage.service';
import { SkusModule } from '../skus/skus.module';
import type { AppAction, AppSubjects } from './ability.types';
import { CaslAbilityFactory } from './casl-ability.factory';

const MANAGER: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'MANAGER',
  sessionId: '22222222-2222-4222-8222-222222222222',
};

const CLIENT: AuthenticatedUser = { ...MANAGER, role: 'CLIENT' };

@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: { get: () => 'USD' } }],
  exports: [ConfigService],
})
class StubConfigModule {}

describe('the abilities each feature registers', () => {
  let abilities: CaslAbilityFactory;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        StubConfigModule,
        ProductsModule,
        SkusModule,
        ImagesModule,
        CartModule,
        OrdersModule,
        PaymentsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(S3StorageService)
      .useValue({})
      .overrideProvider(StripeClient)
      .useValue({})
      .compile();

    await moduleRef.init();
    abilities = moduleRef.get(CaslAbilityFactory);
  });

  const can = (
    user: AuthenticatedUser,
    action: AppAction,
    subject: AppSubjects,
  ) => abilities.createForUser(user).can(action, subject);

  const MANAGER_ACTIONS: Array<[AppAction, AppSubjects]> = [
    ['create', 'Product'],
    ['update', 'Product'],
    ['create', 'ProductSku'],
    ['update', 'ProductSku'],
    ['create', 'ProductImage'],
    ['read', 'Order'],
    ['create', 'PaymentLink'],
  ];
  const CLIENT_ACTIONS: Array<[AppAction, AppSubjects]> = [
    ['update', 'ProductLike'],
    ['manage', 'Cart'],
    ['create', 'Order'],
  ];

  it.each(MANAGER_ACTIONS)('lets a manager %s a %s', (action, subject) => {
    expect(can(MANAGER, action, subject)).toBe(true);
  });

  it.each(MANAGER_ACTIONS)(
    'refuses a client who tries to %s a %s',
    (action, subject) => {
      expect(can(CLIENT, action, subject)).toBe(false);
    },
  );

  it.each(CLIENT_ACTIONS)('lets a client %s a %s', (action, subject) => {
    expect(can(CLIENT, action, subject)).toBe(true);
  });

  it('lets both roles update an order', () => {
    expect(can(MANAGER, 'update', 'Order')).toBe(true);
    expect(can(CLIENT, 'update', 'Order')).toBe(true);
  });

  it('grants a manager nothing beyond what a feature registered', () => {
    expect(can(MANAGER, 'delete', 'Product')).toBe(false);
    expect(can(MANAGER, 'delete', 'ProductSku')).toBe(false);
    expect(can(MANAGER, 'manage', 'Product')).toBe(false);
    expect(can(MANAGER, 'manage', 'all')).toBe(false);
    expect(can(MANAGER, 'update', 'ProductLike')).toBe(false);
    expect(can(MANAGER, 'manage', 'Cart')).toBe(false);
    expect(can(MANAGER, 'create', 'Order')).toBe(false);
    expect(abilities.createForUser(MANAGER).rules).toHaveLength(8);
  });

  it('grants a client nothing beyond what a feature registered', () => {
    expect(can(CLIENT, 'create', 'Product')).toBe(false);
    expect(can(CLIENT, 'update', 'Product')).toBe(false);
    expect(can(CLIENT, 'delete', 'ProductLike')).toBe(false);
    expect(can(CLIENT, 'manage', 'CartItem')).toBe(false);
    expect(can(CLIENT, 'read', 'Order')).toBe(false);
    expect(can(CLIENT, 'manage', 'all')).toBe(false);
    expect(abilities.createForUser(CLIENT).rules).toHaveLength(4);
  });

  it('builds a fresh ability per caller, so roles never leak between them', () => {
    expect(can(MANAGER, 'create', 'Product')).toBe(true);
    expect(can(CLIENT, 'create', 'Product')).toBe(false);
    expect(can(MANAGER, 'create', 'Product')).toBe(true);
  });
});
