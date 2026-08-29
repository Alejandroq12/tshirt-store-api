import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordService } from './password.service';
import { SecretTokenService } from './secret-token.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({}), PrismaModule, MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    SecretTokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenService, PasswordService, SecretTokenService],
})
export class AuthModule {}
