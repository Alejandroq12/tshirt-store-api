import { IsEmail, IsString, MinLength } from 'class-validator';

import { MaxCodePoints } from '../common/validation/max-code-points.decorator';

export class SignUpRequest {
  @IsEmail()
  @MaxCodePoints(255)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxCodePoints(128)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxCodePoints(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxCodePoints(100)
  lastName!: string;
}

export class LoginRequest {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshTokenRequest {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class ForgotPasswordRequest {
  @IsEmail()
  email!: string;
}

export class ResetPasswordRequest {
  @IsString()
  @MinLength(1)
  resetToken!: string;

  @IsString()
  @MinLength(8)
  @MaxCodePoints(128)
  newPassword!: string;
}

export class ChangePasswordRequest {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxCodePoints(128)
  newPassword!: string;
}
