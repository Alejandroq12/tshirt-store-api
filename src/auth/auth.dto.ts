import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SignUpRequest {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
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
  @MaxLength(128)
  newPassword!: string;
}

export class ChangePasswordRequest {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
