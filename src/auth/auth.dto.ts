import { IsEmail, IsString } from 'class-validator';

import { MaxCodePoints } from '../common/validation/max-code-points.decorator';
import { MinCodePoints } from '../common/validation/min-code-points.decorator';

export class SignUpRequest {
  @IsEmail()
  @MaxCodePoints(255)
  email!: string;

  @IsString()
  @MinCodePoints(8)
  @MaxCodePoints(128)
  password!: string;

  @IsString()
  @MinCodePoints(1)
  @MaxCodePoints(100)
  firstName!: string;

  @IsString()
  @MinCodePoints(1)
  @MaxCodePoints(100)
  lastName!: string;
}

export class LoginRequest {
  @IsEmail()
  email!: string;

  @IsString()
  @MinCodePoints(1)
  password!: string;
}

export class RefreshTokenRequest {
  @IsString()
  @MinCodePoints(1)
  refreshToken!: string;
}

export class ForgotPasswordRequest {
  @IsEmail()
  email!: string;
}

export class ResetPasswordRequest {
  @IsString()
  @MinCodePoints(1)
  resetToken!: string;

  @IsString()
  @MinCodePoints(8)
  @MaxCodePoints(128)
  newPassword!: string;
}

export class ChangePasswordRequest {
  @IsString()
  @MinCodePoints(1)
  currentPassword!: string;

  @IsString()
  @MinCodePoints(8)
  @MaxCodePoints(128)
  newPassword!: string;
}
