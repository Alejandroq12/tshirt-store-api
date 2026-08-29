import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { PasswordService } from '../src/auth/password.service';
import { SecretTokenService } from '../src/auth/secret-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './support/create-test-app';
import { truncateAll } from './support/database';

describe('a notification that cannot be delivered (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let secrets: SecretTokenService;
  const send = jest.fn<Promise<void>, [unknown]>();

  beforeAll(async () => {
    app = (await createTestApp({ mail: { send } })) as INestApplication<App>;
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);
    secrets = app.get(SecretTokenService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    send.mockReset().mockRejectedValue(new Error('smtp is down'));
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('does not fail a password reset the database already committed', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'ana@example.com',
        passwordHash: await passwords.hash('example-password'),
        firstName: 'Ana',
        lastName: 'Rivera',
      },
    });
    const token = secrets.generate();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: secrets.digest(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .send({ resetToken: token, newPassword: 'replacement-password' })
      .expect(204);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    await expect(
      passwords.verify('replacement-password', stored.passwordHash),
    ).resolves.toBe(true);
  });

  it('answers 202 for a known address, so a failure reveals nothing', async () => {
    await prisma.user.create({
      data: {
        email: 'known@example.com',
        passwordHash: await passwords.hash('example-password'),
        firstName: 'Ana',
        lastName: 'Rivera',
      },
    });

    const known = await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email: 'known@example.com' });
    const unknown = await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ email: 'unknown@example.com' });

    expect(known.status).toBe(202);
    expect(known.status).toBe(unknown.status);
  });

  it('does not fail a password change the database already committed', async () => {
    const signUp = await request(app.getHttpServer())
      .post('/v1/auth/sign-up')
      .send({
        email: 'luis@example.com',
        password: 'example-password',
        firstName: 'Luis',
        lastName: 'Paz',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/auth/change-password')
      .set(
        'Authorization',
        `Bearer ${(signUp.body as { accessToken: string }).accessToken}`,
      )
      .send({
        currentPassword: 'example-password',
        newPassword: 'replacement-password',
      })
      .expect(204);
  });
});
