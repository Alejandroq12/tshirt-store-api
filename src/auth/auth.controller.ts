import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { PasswordResetThrottle } from '../security/password-reset-throttle.decorator';
import type { AuthenticatedUser } from './authenticated-user';
import {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RefreshTokenRequest,
  ResetPasswordRequest,
  SignUpRequest,
} from './auth.dto';
import {
  AccessTokenResponse,
  AuthService,
  AuthSessionResponse,
} from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('sign-up')
  @Public()
  signUp(@Body() input: SignUpRequest): Promise<AuthSessionResponse> {
    return this.auth.signUp(input);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  login(@Body() input: LoginRequest): Promise<AuthSessionResponse> {
    return this.auth.login(input);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logout(user);
  }

  @Post('refresh-token')
  @Public()
  @HttpCode(HttpStatus.OK)
  refreshAccessToken(
    @Body() input: RefreshTokenRequest,
  ): Promise<AccessTokenResponse> {
    return this.auth.refreshAccessToken(input.refreshToken);
  }

  @Post('forgot-password')
  @Public()
  @PasswordResetThrottle()
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(@Body() input: ForgotPasswordRequest): Promise<void> {
    return this.auth.forgotPassword(input.email);
  }

  @Post('reset-password')
  @Public()
  @PasswordResetThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() input: ResetPasswordRequest): Promise<void> {
    return this.auth.resetPassword(input);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: ChangePasswordRequest,
  ): Promise<void> {
    return this.auth.changePassword(user, input);
  }
}
