import { applyDecorators, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

export const PasswordResetThrottle = (): MethodDecorator & ClassDecorator =>
  applyDecorators(UseGuards(ThrottlerGuard));
