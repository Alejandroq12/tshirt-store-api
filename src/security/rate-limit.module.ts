import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerModule,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';

import type { EnvironmentVariables } from '../config/env.validation';

export const buildThrottlerOptions = (
  config: ConfigService<EnvironmentVariables, true>,
): ThrottlerModuleOptions => ({
  errorMessage: 'Too many password-reset requests. Try again later.',
  throttlers: [
    {
      // A custom name changes the contract's `Retry-After` header.
      name: 'default',
      limit: config.get('PASSWORD_RESET_RATE_LIMIT', { infer: true }),
      ttl:
        config.get('PASSWORD_RESET_RATE_TTL_SECONDS', { infer: true }) * 1000,
    },
  ],
});

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildThrottlerOptions,
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
