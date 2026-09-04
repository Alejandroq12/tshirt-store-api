import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { CartModule } from './cart/cart.module';
import { AppConfigModule } from './config/config.module';
import { ImagesModule } from './images/images.module';
import { LoggingModule } from './logging/logging.module';
import { MailModule } from './mail/mail.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { RateLimitModule } from './security/rate-limit.module';
import { SkusModule } from './skus/skus.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    PrismaModule,
    AuthModule,
    AuthorizationModule,
    ProductsModule,
    SkusModule,
    ImagesModule,
    CartModule,
    OrdersModule,
    RateLimitModule,
    MailModule,
  ],
})
export class AppModule {}
