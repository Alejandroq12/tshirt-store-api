import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { AppConfigService } from '../src/config/config.module';
import { createTestApp } from './support/create-test-app';

describe('Application bootstrap (e2e)', () => {
  let app: INestApplication<App>;
  let rateLimit: number;

  beforeAll(async () => {
    app = (await createTestApp()) as INestApplication<App>;
    rateLimit = app
      .get<AppConfigService>(ConfigService)
      .get('PASSWORD_RESET_RATE_LIMIT', { infer: true });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  describe('security headers', () => {
    it('sends the headers helmet is here for', async () => {
      const { headers } = await get('/v1/probe/guarded');

      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(headers['strict-transport-security']).toContain('max-age=');
      expect(headers['content-security-policy']).toContain(
        "default-src 'self'",
      );
    });

    it('does not advertise the framework', async () => {
      const { headers } = await get('/v1/probe/guarded');

      expect(headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('allows a configured origin', async () => {
      const { headers } = await get('/v1/probe/guarded').set(
        'Origin',
        'http://localhost:5173',
      );

      expect(headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
      expect(headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not allow an origin outside the list', async () => {
      const { headers } = await get('/v1/probe/guarded').set(
        'Origin',
        'https://attacker.example',
      );

      expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('exposes the headers a browser has to read', async () => {
      const { headers } = await get('/v1/probe/guarded').set(
        'Origin',
        'http://localhost:5173',
      );

      const exposed = (headers['access-control-expose-headers'] ?? '').split(
        /,\s*/,
      );
      expect(exposed).toContain('X-Request-Id');
      expect(exposed).toContain('Retry-After');
    });
  });

  describe('correlation id', () => {
    it('is set on every response', async () => {
      const { headers } = await get('/v1/probe/guarded');

      expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('differs between requests', async () => {
      const [first, second] = await Promise.all([
        get('/v1/probe/guarded'),
        get('/v1/probe/guarded'),
      ]);

      expect(first.headers['x-request-id']).not.toBe(
        second.headers['x-request-id'],
      );
    });

    it('echoes one the caller supplied, so a trace spans services', async () => {
      const { headers } = await get('/v1/probe/guarded').set(
        'X-Request-Id',
        'trace-abc-123',
      );

      expect(headers['x-request-id']).toBe('trace-abc-123');
    });

    it('replaces one that could forge a log line', async () => {
      const { headers } = await get('/v1/probe/guarded').set(
        'X-Request-Id',
        'abc {"level":30}',
      );

      expect(headers['x-request-id']).not.toBe('abc {"level":30}');
      expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('raw body', () => {
    it('keeps the bytes as sent, alongside the parsed body', async () => {
      const payload = '{"id":"evt_1","type":"checkout.session.completed"}';

      const response = await request(app.getHttpServer())
        .post('/v1/probe/raw')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);

      expect(response.body).toEqual({
        isBuffer: true,
        length: payload.length,
        parsedKeys: ['id', 'type'],
      });
    });
  });

  describe('the password-reset rate limit', () => {
    it('answers 429 in problem+json once the window is exhausted', async () => {
      let last = await get('/v1/probe/throttled');

      for (let attempt = 0; attempt < rateLimit + 1; attempt += 1) {
        last = await get('/v1/probe/throttled');
      }

      expect(last.status).toBe(429);
      expect(last.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(last.body).toMatchObject({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
      });
    });

    it('sends Retry-After, which the contract declares on that response', async () => {
      let last = await get('/v1/probe/throttled');

      for (let attempt = 0; attempt < rateLimit + 1; attempt += 1) {
        last = await get('/v1/probe/throttled');
      }

      expect(last.headers['retry-after']).toMatch(/^\d+$/);
    });

    it('says nothing about its own exception class in the body', async () => {
      let last = await get('/v1/probe/throttled');

      for (let attempt = 0; attempt < rateLimit + 1; attempt += 1) {
        last = await get('/v1/probe/throttled');
      }

      expect(JSON.stringify(last.body)).not.toContain('ThrottlerException');
    });

    it('leaves unthrottled routes alone', async () => {
      await get('/v1/probe/guarded').expect(401);
    });
  });
});
