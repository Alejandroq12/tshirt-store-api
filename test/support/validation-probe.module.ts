import { Body, Controller, Get, Module, Post, RawBody } from '@nestjs/common';
import { IsEmail, IsInt, Min } from 'class-validator';

import type { AuthenticatedUser } from '../../src/auth/authenticated-user';
import { CurrentUser } from '../../src/auth/decorators/current-user.decorator';
import { Public } from '../../src/auth/decorators/public.decorator';
import { PasswordResetThrottle } from '../../src/security/password-reset-throttle.decorator';

export class ProbeDto {
  @IsEmail()
  email!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

@Public()
@Controller('probe')
export class ValidationProbeController {
  @Post()
  echo(@Body() body: ProbeDto): ProbeDto {
    return body;
  }
}

@Controller('probe/guarded')
export class GuardedProbeController {
  @Get()
  whoAmI(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

@Public()
@Controller('probe/raw')
export class RawBodyProbeController {
  @Post()
  describe(@RawBody() raw: Buffer | undefined, @Body() parsed: unknown) {
    return {
      isBuffer: Buffer.isBuffer(raw),
      length: raw?.length ?? null,
      parsedKeys: Object.keys(parsed as Record<string, unknown>),
    };
  }
}

@Public()
@PasswordResetThrottle()
@Controller('probe/throttled')
export class ThrottledProbeController {
  @Get()
  ok(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  controllers: [
    ValidationProbeController,
    GuardedProbeController,
    RawBodyProbeController,
    ThrottledProbeController,
  ],
})
export class ValidationProbeModule {}
