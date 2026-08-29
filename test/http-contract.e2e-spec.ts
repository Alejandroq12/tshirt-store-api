import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { TokenService } from '../src/auth/token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './support/create-test-app';
import { truncateAll } from './support/database';
import { createClient } from './support/fixtures';

const PROBLEM_KEYS = ['type', 'title', 'status', 'detail', 'instance'];

describe('HTTP contract (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = (await createTestApp()) as INestApplication<App>;
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, body: object) =>
    request(app.getHttpServer()).post(path).send(body);

  describe('every route is served under /v1', () => {
    it('serves the prefixed path', async () => {
      await post('/v1/probe', { email: 'ana@example.com', quantity: 2 }).expect(
        201,
      );
    });

    it('does not serve the unprefixed path', async () => {
      await post('/probe', { email: 'ana@example.com', quantity: 2 }).expect(
        404,
      );
    });
  });

  describe('errors are application/problem+json', () => {
    it('renders an unknown route as a problem document', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/does-not-exist')
        .expect(404);

      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.body).toMatchObject({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
      });
    });

    it('carries no field the Problem schema forbids', async () => {
      const response = await request(app.getHttpServer()).get(
        '/v1/does-not-exist',
      );

      expect(
        Object.keys(response.body as Record<string, unknown>).filter(
          (key) => !PROBLEM_KEYS.includes(key),
        ),
      ).toEqual([]);
    });
  });

  describe('an invalid body returns 422, not 400', () => {
    it('answers 422 in problem+json', async () => {
      const response = await post('/v1/probe', {}).expect(422);

      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.body).toMatchObject({
        type: 'about:blank',
        title: 'Unprocessable Content',
        status: 422,
      });
    });

    it('names every failed field', async () => {
      const response = await post('/v1/probe', {
        email: 'not-an-email',
        quantity: 0,
      }).expect(422);

      const fields = (
        response.body as { errors: { field: string }[] }
      ).errors.map((entry) => entry.field);

      expect(fields).toContain('email');
      expect(fields).toContain('quantity');
    });

    it('always carries at least one error, as minItems: 1 requires', async () => {
      const response = await post('/v1/probe', {}).expect(422);

      expect(
        (response.body as { errors: unknown[] }).errors.length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe('an unknown property is rejected, not ignored', () => {
    it('refuses a body that is otherwise valid', async () => {
      const response = await post('/v1/probe', {
        email: 'ana@example.com',
        quantity: 2,
        nickname: 'ana',
      }).expect(422);

      const errors = (response.body as { errors: { field: string }[] }).errors;
      expect(errors.map((entry) => entry.field)).toContain('nickname');
    });

    it('does not silently strip it and succeed', async () => {
      await post('/v1/probe', {
        email: 'ana@example.com',
        quantity: 2,
        nickname: 'ana',
      }).expect((response) => {
        expect(response.status).not.toBe(201);
      });
    });
  });
});

describe('Authentication guard (e2e)', () => {
  let app: INestApplication<App>;
  let tokens: TokenService;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = (await createTestApp()) as INestApplication<App>;
    tokens = app.get(TokenService);
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  const guarded = () => request(app.getHttpServer()).get('/v1/probe/guarded');

  it('protects a route nobody marked, which is the default that matters', async () => {
    const response = await guarded().expect(401);

    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.body).toMatchObject({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
    });
  });

  it('resolves the caller from a valid access token', async () => {
    const user = await createClient(prisma);
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: 'guard-test-refresh-hash',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const { token } = await tokens.issueAccessToken({
      id: user.id,
      role: user.role,
      sessionId: session.id,
    });

    const response = await guarded()
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      id: user.id,
      role: 'CLIENT',
      sessionId: session.id,
    });
  });

  it('refuses a refresh token presented as a bearer credential', async () => {
    const { token } = await tokens.issueRefreshToken({
      id: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
    });

    await guarded().set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('refuses a malformed credential', async () => {
    await guarded().set('Authorization', 'Bearer not-a-token').expect(401);
    await guarded().set('Authorization', 'Basic dXNlcjpwYXNz').expect(401);
  });
});
