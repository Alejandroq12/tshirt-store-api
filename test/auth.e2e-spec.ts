import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { MailService } from '../src/mail/mail.service';
import { PasswordService } from '../src/auth/password.service';
import { SecretTokenService } from '../src/auth/secret-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './support/create-test-app';
import { truncateAll } from './support/database';
import { createManager, KNOWN_PASSWORD } from './support/fixtures';

interface AuthSessionBody {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: 'manager' | 'client';
  };
}

interface AccessTokenBody {
  accessToken: string;
  accessTokenExpiresAt: string;
}

const CLIENT = {
  email: 'ana@example.com',
  password: 'example-password',
  firstName: 'Ana',
  lastName: 'Rivera',
};

const NEW_PASSWORD = 'replacement-password';

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let secrets: SecretTokenService;
  const sendMail = jest.fn<
    ReturnType<MailService['send']>,
    Parameters<MailService['send']>
  >();

  beforeAll(async () => {
    app = (await createTestApp({
      mail: { send: sendMail },
    })) as INestApplication<App>;
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);
    secrets = app.get(SecretTokenService);
  });

  beforeEach(async () => {
    sendMail.mockReset().mockResolvedValue(undefined);
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  const post = (path: string, body?: object) => {
    const operation = request(app.getHttpServer()).post(path);
    return body === undefined ? operation : operation.send(body);
  };

  const signUp = async (): Promise<AuthSessionBody> => {
    const response = await post('/v1/auth/sign-up', CLIENT).expect(201);
    return response.body as AuthSessionBody;
  };

  const resetTokenFor = async (email: string): Promise<string> => {
    await post('/v1/auth/forgot-password', { email }).expect(202);
    const message = sendMail.mock.calls.at(-1)?.[0];

    if (!message?.text.startsWith('Reset token: ')) {
      throw new Error('Reset email did not contain a token');
    }

    return message.text.slice('Reset token: '.length);
  };

  it('registers only clients and stores their password and session safely', async () => {
    const response = await post('/v1/auth/sign-up', {
      ...CLIENT,
      email: 'ANA@EXAMPLE.COM',
    }).expect(201);
    const body = response.body as AuthSessionBody;

    expect(Object.keys(body).sort()).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'refreshToken',
      'user',
    ]);
    expect(body.user).toEqual({
      id: body.user.id,
      email: CLIENT.email,
      firstName: CLIENT.firstName,
      lastName: CLIENT.lastName,
      role: 'client',
    });
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.accessToken).not.toBe('');
    expect(body.refreshToken).not.toBe('');
    expect(Number.isNaN(Date.parse(body.accessTokenExpiresAt))).toBe(false);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: body.user.id },
    });
    expect(user.role).toBe('CLIENT');
    expect(user.passwordHash).not.toBe(CLIENT.password);
    await expect(
      passwords.verify(CLIENT.password, user.passwordHash),
    ).resolves.toBe(true);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('rejects a duplicate email without creating partial data', async () => {
    await signUp();

    const response = await post('/v1/auth/sign-up', {
      ...CLIENT,
      email: CLIENT.email.toUpperCase(),
    }).expect(409);

    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.body).toMatchObject({
      title: 'Conflict',
      status: 409,
    });
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.session.count()).toBe(1);
  });

  it('logs managers in and does not reveal whether an account exists', async () => {
    const manager = await createManager(prisma, {
      email: 'manager@example.com',
    });
    const success = await post('/v1/auth/login', {
      email: manager.email.toUpperCase(),
      password: KNOWN_PASSWORD,
    }).expect(200);

    expect((success.body as AuthSessionBody).user.role).toBe('manager');

    const wrongPassword = await post('/v1/auth/login', {
      email: manager.email,
      password: 'wrong-password',
    }).expect(401);
    const unknownEmail = await post('/v1/auth/login', {
      email: 'unknown@example.com',
      password: 'wrong-password',
    }).expect(401);

    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('refreshes only the access token without rotating the refresh token', async () => {
    const session = await signUp();
    const stored = await prisma.session.findFirstOrThrow({
      where: { userId: session.user.id },
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await post('/v1/auth/refresh-token', {
        refreshToken: session.refreshToken,
      }).expect(200);
      const body = response.body as AccessTokenBody;

      expect(Object.keys(body).sort()).toEqual([
        'accessToken',
        'accessTokenExpiresAt',
      ]);
      expect(body.accessToken).not.toBe('');
      expect(Number.isNaN(Date.parse(body.accessTokenExpiresAt))).toBe(false);
    }

    const unchanged = await prisma.session.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(unchanged.refreshTokenHash).toBe(stored.refreshTokenHash);
  });

  it('logs out only the current session and rejects its tokens afterwards', async () => {
    const session = await signUp();
    const response = await post('/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(204);

    expect(response.text).toBe('');
    expect(
      await prisma.session.findFirstOrThrow({
        where: { userId: session.user.id },
      }),
    ).toHaveProperty('revokedAt', expect.any(Date));
    await post('/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
    await post('/v1/auth/refresh-token', {
      refreshToken: session.refreshToken,
    }).expect(401);
  });

  it('accepts forgot-password for known and unknown emails without exposing which exists', async () => {
    const session = await signUp();
    const known = await post('/v1/auth/forgot-password', {
      email: session.user.email.toUpperCase(),
    }).expect(202);
    const unknown = await post('/v1/auth/forgot-password', {
      email: 'unknown@example.com',
    }).expect(202);

    expect(known.text).toBe('');
    expect(unknown.text).toBe('');
    expect(sendMail).toHaveBeenCalledTimes(1);

    const message = sendMail.mock.calls[0][0];
    const rawToken = message.text.slice('Reset token: '.length);
    const stored = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: session.user.id },
    });

    expect(message.to).toBe(session.user.email);
    expect(rawToken).not.toBe('');
    expect(stored.tokenHash).toBe(secrets.digest(rawToken));
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(await prisma.passwordResetToken.count()).toBe(1);
  });

  it('uses a reset token once, revokes every session, and sends the notification inline', async () => {
    const first = await signUp();
    const secondResponse = await post('/v1/auth/login', {
      email: CLIENT.email,
      password: CLIENT.password,
    }).expect(200);
    const second = secondResponse.body as AuthSessionBody;
    const resetToken = await resetTokenFor(CLIENT.email);
    sendMail.mockClear();

    const response = await post('/v1/auth/reset-password', {
      resetToken,
      newPassword: NEW_PASSWORD,
    }).expect(204);

    expect(response.text).toBe('');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: CLIENT.email,
      subject: 'Your password was changed',
    });
    expect(
      await prisma.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash: secrets.digest(resetToken) },
      }),
    ).toHaveProperty('usedAt', expect.any(Date));
    expect(
      await prisma.session.count({
        where: { userId: first.user.id, revokedAt: null },
      }),
    ).toBe(0);

    await post('/v1/auth/logout')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(401);
    await post('/v1/auth/refresh-token', {
      refreshToken: second.refreshToken,
    }).expect(401);
    await post('/v1/auth/reset-password', {
      resetToken,
      newPassword: 'another-password',
    }).expect(400);
    await post('/v1/auth/login', {
      email: CLIENT.email,
      password: CLIENT.password,
    }).expect(401);
    await post('/v1/auth/login', {
      email: CLIENT.email,
      password: NEW_PASSWORD,
    }).expect(200);
  });

  it('changes a password only when the current password matches and revokes every session', async () => {
    const first = await signUp();
    const secondResponse = await post('/v1/auth/login', {
      email: CLIENT.email,
      password: CLIENT.password,
    }).expect(200);
    const second = secondResponse.body as AuthSessionBody;

    await post('/v1/auth/change-password', {
      currentPassword: 'wrong-password',
      newPassword: NEW_PASSWORD,
    })
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(400);
    expect(
      await prisma.session.count({
        where: { userId: first.user.id, revokedAt: null },
      }),
    ).toBe(2);

    const response = await post('/v1/auth/change-password', {
      currentPassword: CLIENT.password,
      newPassword: NEW_PASSWORD,
    })
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(204);

    expect(response.text).toBe('');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: CLIENT.email,
      subject: 'Your password was changed',
    });
    expect(
      await prisma.session.count({
        where: { userId: first.user.id, revokedAt: null },
      }),
    ).toBe(0);

    await post('/v1/auth/logout')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(401);
    await post('/v1/auth/refresh-token', {
      refreshToken: second.refreshToken,
    }).expect(401);
    await post('/v1/auth/login', {
      email: CLIENT.email,
      password: CLIENT.password,
    }).expect(401);
    await post('/v1/auth/login', {
      email: CLIENT.email,
      password: NEW_PASSWORD,
    }).expect(200);
  });

  it('protects logout and change-password', async () => {
    await post('/v1/auth/logout').expect(401);
    await post('/v1/auth/change-password', {
      currentPassword: CLIENT.password,
      newPassword: NEW_PASSWORD,
    }).expect(401);
  });

  it('returns 422 for invalid request bodies and unknown fields', async () => {
    const publicCases: Array<[string, object]> = [
      ['/v1/auth/sign-up', { ...CLIENT, password: 'short', role: 'manager' }],
      ['/v1/auth/login', { email: 'not-an-email', password: '' }],
      ['/v1/auth/refresh-token', { refreshToken: '' }],
      ['/v1/auth/forgot-password', { email: 'not-an-email' }],
      ['/v1/auth/reset-password', { resetToken: '', newPassword: 'short' }],
    ];

    for (const [path, body] of publicCases) {
      const response = await post(path, body).expect(422);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
    }

    const session = await signUp();
    await post('/v1/auth/change-password', {
      currentPassword: CLIENT.password,
      newPassword: 'short',
    })
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(422);
  });
});

describe('Password-reset rate limit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sendMail = jest.fn<
    ReturnType<MailService['send']>,
    Parameters<MailService['send']>
  >();

  beforeAll(async () => {
    sendMail.mockResolvedValue(undefined);
    app = (await createTestApp({
      mail: { send: sendMail },
    })) as INestApplication<App>;
    prisma = app.get(PrismaService);
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('returns 429 on forgot-password after the configured limit', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/v1/auth/forgot-password')
        .send({ email: 'unknown@example.com' })
        .expect(202);
    }

    await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email: 'unknown@example.com' })
      .expect(429);
  });

  it('returns 429 on reset-password after the configured limit', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/v1/auth/reset-password')
        .send({})
        .expect(422);
    }

    await request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .send({})
      .expect(429);
  });
});
