import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordService } from './password.service';
import { SecretTokenService } from './secret-token.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [
    TokenService,
    PasswordService,
    SecretTokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokenService, PasswordService, SecretTokenService],
})
export class AuthModule {}
