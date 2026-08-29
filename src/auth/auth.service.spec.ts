import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';

import type { EnvironmentVariables } from '../config/env.validation';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { PasswordService } from './password.service';
import type { SecretTokenService } from './secret-token.service';
import type { TokenService } from './token.service';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const ACCESS_EXPIRY = new Date('2026-08-28T12:15:00.000Z');
const REFRESH_EXPIRY = new Date('2026-09-27T12:00:00.000Z');

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@example.com',
  passwordHash: 'stored-hash',
  firstName: 'Ana',
  lastName: 'Rivera',
  role: UserRole.CLIENT,
};

describe('AuthService', () => {
  const userFindUnique = jest.fn();
  const userCreate = jest.fn();
  const userUpdate = jest.fn();
  const sessionCreate = jest.fn();
  const sessionFindFirst = jest.fn();
  const sessionUpdateMany = jest.fn();
  const resetCreate = jest.fn();
  const resetFindUnique = jest.fn();
  const resetUpdateMany = jest.fn();
  const transaction = {
    user: { create: userCreate, update: userUpdate },
    session: { create: sessionCreate, updateMany: sessionUpdateMany },
    passwordResetToken: {
      findUnique: resetFindUnique,
      updateMany: resetUpdateMany,
    },
  };
  const runTransaction = jest.fn(
    async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  );
  const prisma = {
    user: { findUnique: userFindUnique },
    session: {
      create: sessionCreate,
      findFirst: sessionFindFirst,
      updateMany: sessionUpdateMany,
    },
    passwordResetToken: { create: resetCreate },
    $transaction: runTransaction,
  } as unknown as PrismaService;

  const hash = jest.fn();
  const verify = jest.fn();
  const passwords = { hash, verify } as unknown as PasswordService;
  const generate = jest.fn();
  const digest = jest.fn();
  const secretTokens = {
    generate,
    digest,
  } as unknown as SecretTokenService;
  const issueAccessToken = jest.fn();
  const issueRefreshToken = jest.fn();
  const verifyRefreshToken = jest.fn();
  const tokens = {
    issueAccessToken,
    issueRefreshToken,
    verifyRefreshToken,
  } as unknown as TokenService;
  const send = jest.fn();
  const mail = { send } as unknown as MailService;

  const serviceWith = (ttl = '1h') =>
    new AuthService(prisma, passwords, secretTokens, tokens, mail, {
      get: () => ttl,
    } as unknown as ConfigService<EnvironmentVariables, true>);

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    hash.mockResolvedValue('new-hash');
    verify.mockResolvedValue(true);
    generate.mockReturnValue('reset-token');
    digest.mockImplementation((value: string) => `hash:${value}`);
    issueAccessToken.mockResolvedValue({
      token: 'access-token',
      expiresAt: ACCESS_EXPIRY,
    });
    issueRefreshToken.mockResolvedValue({
      token: 'refresh-token',
      expiresAt: REFRESH_EXPIRY,
    });
    verifyRefreshToken.mockResolvedValue({
      sub: USER.id,
      sid: '22222222-2222-4222-8222-222222222222',
    });
    userCreate.mockResolvedValue(USER);
    userUpdate.mockResolvedValue(USER);
    sessionCreate.mockResolvedValue(undefined);
    sessionUpdateMany.mockResolvedValue({ count: 1 });
    resetCreate.mockResolvedValue(undefined);
    resetUpdateMany.mockResolvedValue({ count: 1 });
    send.mockResolvedValue(undefined);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('creates a client and its session atomically on sign-up', async () => {
    const response = await serviceWith().signUp({
      email: 'ANA@EXAMPLE.COM',
      password: 'example-password',
      firstName: 'Ana',
      lastName: 'Rivera',
    });

    expect(response).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: ACCESS_EXPIRY.toISOString(),
      user: {
        id: response.user.id,
        email: 'ana@example.com',
        firstName: 'Ana',
        lastName: 'Rivera',
        role: 'client',
      },
    });
    expect(userCreate).toHaveBeenCalledWith({
      data: {
        id: response.user.id,
        email: 'ana@example.com',
        firstName: 'Ana',
        lastName: 'Rivera',
        passwordHash: 'new-hash',
        role: UserRole.CLIENT,
      },
    });
    const sessionCall = (
      sessionCreate.mock.calls as Array<
        [
          {
            data: {
              id: string;
              userId: string;
              refreshTokenHash: string;
              expiresAt: Date;
            };
          },
        ]
      >
    )[0][0];
    expect(sessionCall.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionCall.data).toEqual({
      id: sessionCall.data.id,
      userId: response.user.id,
      refreshTokenHash: 'hash:refresh-token',
      expiresAt: REFRESH_EXPIRY,
    });
  });

  it('logs a manager in and stores a new session', async () => {
    userFindUnique.mockResolvedValue({ ...USER, role: UserRole.MANAGER });

    const response = await serviceWith().login({
      email: 'ANA@EXAMPLE.COM',
      password: 'example-password',
    });

    expect(verify).toHaveBeenCalledWith('example-password', 'stored-hash');
    expect(response.user.role).toBe('manager');
    expect(sessionCreate).toHaveBeenCalledTimes(1);
  });

  it('returns the same unauthorized result for an unknown email', async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(
      serviceWith().login({
        email: 'missing@example.com',
        password: 'example-password',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(hash).toHaveBeenCalledWith('example-password');
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects an incorrect password', async () => {
    userFindUnique.mockResolvedValue(USER);
    verify.mockResolvedValue(false);

    await expect(
      serviceWith().login({
        email: USER.email,
        password: 'wrong-password',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('revokes only the current session on logout', async () => {
    await serviceWith().logout({
      id: USER.id,
      role: UserRole.CLIENT,
      sessionId: '22222222-2222-4222-8222-222222222222',
    });

    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: '22222222-2222-4222-8222-222222222222',
        userId: USER.id,
        revokedAt: null,
      },
      data: { revokedAt: NOW },
    });
  });

  it('refreshes only the access token for a live matching session', async () => {
    sessionFindFirst.mockResolvedValue({
      user: { id: USER.id, role: UserRole.CLIENT },
    });

    const response = await serviceWith().refreshAccessToken('refresh-token');

    expect(response).toEqual({
      accessToken: 'access-token',
      accessTokenExpiresAt: ACCESS_EXPIRY.toISOString(),
    });
    expect(response).not.toHaveProperty('refreshToken');
    expect(sessionCreate).not.toHaveBeenCalled();
    const refreshQuery = (
      sessionFindFirst.mock.calls as Array<
        [{ where: { refreshTokenHash: string; revokedAt: null } }]
      >
    )[0][0];
    expect(refreshQuery.where).toMatchObject({
      refreshTokenHash: 'hash:refresh-token',
      revokedAt: null,
    });
  });

  it('rejects a refresh token without a live matching session', async () => {
    sessionFindFirst.mockResolvedValue(null);

    await expect(
      serviceWith().refreshAccessToken('refresh-token'),
    ).rejects.toThrow(UnauthorizedException);
    expect(issueAccessToken).not.toHaveBeenCalled();
  });

  it('creates and emails a hashed reset token for an existing user', async () => {
    userFindUnique.mockResolvedValue({ id: USER.id, email: USER.email });

    await serviceWith().forgotPassword('ANA@EXAMPLE.COM');

    expect(resetCreate).toHaveBeenCalledWith({
      data: {
        userId: USER.id,
        tokenHash: 'hash:reset-token',
        expiresAt: new Date('2026-08-28T13:00:00.000Z'),
      },
    });
    expect(send).toHaveBeenCalledWith({
      to: USER.email,
      subject: 'Reset your password',
      text: 'Reset token: reset-token',
    });
  });

  it('reveals nothing and sends nothing for an unknown reset email', async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(
      serviceWith().forgotPassword('missing@example.com'),
    ).resolves.toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('uses a reset token once, changes the password, and revokes all sessions', async () => {
    resetFindUnique.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      userId: USER.id,
      expiresAt: new Date('2026-08-28T13:00:00.000Z'),
      usedAt: null,
      user: { email: USER.email },
    });

    await serviceWith().resetPassword({
      resetToken: 'reset-token',
      newPassword: 'replacement-password',
    });

    expect(resetUpdateMany).toHaveBeenCalledWith({
      where: {
        id: '33333333-3333-4333-8333-333333333333',
        usedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { usedAt: NOW },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: USER.id },
      data: { passwordHash: 'new-hash' },
    });
    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, revokedAt: null },
      data: { revokedAt: NOW },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: USER.email,
        subject: 'Your password was changed',
      }),
    );
  });

  it.each([
    ['missing', null],
    [
      'used',
      {
        id: 'token-id',
        userId: USER.id,
        expiresAt: new Date('2026-08-28T13:00:00.000Z'),
        usedAt: NOW,
        user: { email: USER.email },
      },
    ],
    [
      'expired',
      {
        id: 'token-id',
        userId: USER.id,
        expiresAt: new Date('2026-08-28T11:59:59.000Z'),
        usedAt: null,
        user: { email: USER.email },
      },
    ],
  ])('rejects a %s reset token', async (_label, token) => {
    resetFindUnique.mockResolvedValue(token);

    await expect(
      serviceWith().resetPassword({
        resetToken: 'reset-token',
        newPassword: 'replacement-password',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a reset token another request claimed first', async () => {
    resetFindUnique.mockResolvedValue({
      id: 'token-id',
      userId: USER.id,
      expiresAt: new Date('2026-08-28T13:00:00.000Z'),
      usedAt: null,
      user: { email: USER.email },
    });
    resetUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      serviceWith().resetPassword({
        resetToken: 'reset-token',
        newPassword: 'replacement-password',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('changes a password, revokes every session, and sends the email', async () => {
    userFindUnique.mockResolvedValue({
      email: USER.email,
      passwordHash: USER.passwordHash,
    });

    await serviceWith().changePassword(
      {
        id: USER.id,
        role: UserRole.CLIENT,
        sessionId: '22222222-2222-4222-8222-222222222222',
      },
      {
        currentPassword: 'example-password',
        newPassword: 'replacement-password',
      },
    );

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: USER.id },
      data: { passwordHash: 'new-hash' },
    });
    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, revokedAt: null },
      data: { revokedAt: NOW },
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: USER.email }),
    );
  });

  it('rejects an incorrect current password without changing anything', async () => {
    userFindUnique.mockResolvedValue({
      email: USER.email,
      passwordHash: USER.passwordHash,
    });
    verify.mockResolvedValue(false);

    await expect(
      serviceWith().changePassword(
        {
          id: USER.id,
          role: UserRole.CLIENT,
          sessionId: '22222222-2222-4222-8222-222222222222',
        },
        {
          currentPassword: 'wrong-password',
          newPassword: 'replacement-password',
        },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a password change for a missing user', async () => {
    userFindUnique.mockResolvedValue(null);

    await expect(
      serviceWith().changePassword(
        {
          id: USER.id,
          role: UserRole.CLIENT,
          sessionId: '22222222-2222-4222-8222-222222222222',
        },
        {
          currentPassword: 'example-password',
          newPassword: 'replacement-password',
        },
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('accepts only a live session whose stored role still matches', async () => {
    sessionFindFirst.mockResolvedValue({ user: { role: UserRole.CLIENT } });
    const user = {
      id: USER.id,
      role: UserRole.CLIENT,
      sessionId: '22222222-2222-4222-8222-222222222222',
    };

    await expect(serviceWith().isSessionActive(user)).resolves.toBe(true);

    sessionFindFirst.mockResolvedValue({ user: { role: UserRole.MANAGER } });
    await expect(serviceWith().isSessionActive(user)).resolves.toBe(false);

    sessionFindFirst.mockResolvedValue(null);
    await expect(serviceWith().isSessionActive(user)).resolves.toBe(false);
  });

  it('rejects an invalid reset-token duration', () => {
    expect(() => serviceWith('one hour')).toThrow('Invalid duration');
    expect(() => serviceWith(`${Number.MAX_SAFE_INTEGER}y`)).toThrow(
      'Invalid duration',
    );
  });
});
