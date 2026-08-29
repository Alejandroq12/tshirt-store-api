import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { AppConfigModule } from './config/config.module';
import { ImagesModule } from './images/images.module';
import { LoggingModule } from './logging/logging.module';
import { MailModule } from './mail/mail.module';
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
    RateLimitModule,
    MailModule,
  ],
})
export class AppModule {}
