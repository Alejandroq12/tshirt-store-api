import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { AuthenticatedUser } from './authenticated-user';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import { IS_PUBLIC } from './decorators/public.decorator';

type MethodName = keyof Pick<
  AuthController,
  | 'signUp'
  | 'login'
  | 'logout'
  | 'refreshAccessToken'
  | 'forgotPassword'
  | 'resetPassword'
  | 'changePassword'
>;

const metadataFor = (key: string, method: MethodName): unknown => {
  const target = Object.getOwnPropertyDescriptor(
    AuthController.prototype,
    method,
  )?.value as object | undefined;

  if (!target) throw new Error(`Missing controller method: ${method}`);
  return Reflect.getMetadata(key, target) as unknown;
};

describe('AuthController', () => {
  const auth = {
    signUp: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refreshAccessToken: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
  };
  const controller = new AuthController(auth as unknown as AuthService);
  const user: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'CLIENT',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates each operation without changing its input', async () => {
    const signUp = {
      email: 'ana@example.com',
      password: 'example-password',
      firstName: 'Ana',
      lastName: 'Rivera',
    };
    const login = { email: signUp.email, password: signUp.password };
    const reset = {
      resetToken: 'reset-token',
      newPassword: 'replacement-password',
    };
    const change = {
      currentPassword: signUp.password,
      newPassword: reset.newPassword,
    };

    await controller.signUp(signUp);
    await controller.login(login);
    await controller.logout(user);
    await controller.refreshAccessToken({ refreshToken: 'refresh-token' });
    await controller.forgotPassword({ email: signUp.email });
    await controller.resetPassword(reset);
    await controller.changePassword(user, change);

    expect(auth.signUp).toHaveBeenCalledWith(signUp);
    expect(auth.login).toHaveBeenCalledWith(login);
    expect(auth.logout).toHaveBeenCalledWith(user);
    expect(auth.refreshAccessToken).toHaveBeenCalledWith('refresh-token');
    expect(auth.forgotPassword).toHaveBeenCalledWith(signUp.email);
    expect(auth.resetPassword).toHaveBeenCalledWith(reset);
    expect(auth.changePassword).toHaveBeenCalledWith(user, change);
  });

  it('marks exactly the five anonymous operations public', () => {
    const publicMethods = [
      'signUp',
      'login',
      'refreshAccessToken',
      'forgotPassword',
      'resetPassword',
    ] as const;
    const protectedMethods = ['logout', 'changePassword'] as const;

    for (const method of publicMethods) {
      expect(metadataFor(IS_PUBLIC, method)).toBe(true);
    }
    for (const method of protectedMethods) {
      expect(metadataFor(IS_PUBLIC, method)).toBeUndefined();
    }
  });

  it('applies the password-reset throttle to exactly two operations', () => {
    const throttled = ['forgotPassword', 'resetPassword'] as const;
    const unthrottled = [
      'signUp',
      'login',
      'logout',
      'refreshAccessToken',
      'changePassword',
    ] as const;

    for (const method of throttled) {
      expect(metadataFor(GUARDS_METADATA, method)).toContain(ThrottlerGuard);
    }
    for (const method of unthrottled) {
      expect(metadataFor(GUARDS_METADATA, method)).toBeUndefined();
    }
  });

  it('uses the response status codes declared by the contract', () => {
    expect(metadataFor(HTTP_CODE_METADATA, 'signUp')).toBeUndefined();
    expect(metadataFor(HTTP_CODE_METADATA, 'login')).toBe(200);
    expect(metadataFor(HTTP_CODE_METADATA, 'logout')).toBe(204);
    expect(metadataFor(HTTP_CODE_METADATA, 'refreshAccessToken')).toBe(200);
    expect(metadataFor(HTTP_CODE_METADATA, 'forgotPassword')).toBe(202);
    expect(metadataFor(HTTP_CODE_METADATA, 'resetPassword')).toBe(204);
    expect(metadataFor(HTTP_CODE_METADATA, 'changePassword')).toBe(204);
  });
});
