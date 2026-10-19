export type { SessionPrincipal } from './types/session-principal';
export { AuthController } from './auth.controller';
export * from './auth.dto';
export { AuthModule } from './auth.module';
export { AuthService } from './services/auth.service';
export type {
  AccessTokenResponse,
  AuthSessionResponse,
  UserResponse,
} from './types/auth.types';
export { CurrentUser } from './decorators/current-user.decorator';
export {
  IS_OPTIONAL_AUTH,
  OptionalAuth,
} from './decorators/optional-auth.decorator';
export { IS_PUBLIC, Public } from './decorators/public.decorator';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export { PasswordService } from './services/password.service';
export { SecretTokenService } from './services/secret-token.service';
export { TokenService } from './services/token.service';
export type {
  AccessTokenClaims,
  IssuedToken,
  RefreshTokenClaims,
  SessionSubject,
} from './types/token.types';
