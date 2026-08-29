import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { AppConfigModule } from './config/config.module';
import { LoggingModule } from './logging/logging.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { RateLimitModule } from './security/rate-limit.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    PrismaModule,
    AuthModule,
    AuthorizationModule,
    ProductsModule,
    RateLimitModule,
    StorageModule,
    MailModule,
  ],
})
export class AppModule {}
