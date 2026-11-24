import pino from 'pino';

import { REDACT_PATHS, REDACTED, SECRET_VARIABLES } from './redaction';

// Logs one object through pino configured as LoggingModule configures it and
// returns the line pino wrote.
const logged = (payload: object): Record<string, unknown> => {
  const lines: string[] = [];
  const logger = pino(
    { redact: { paths: [...REDACT_PATHS], censor: REDACTED } },
    { write: (line: string) => lines.push(line) },
  );

  logger.info(payload, 'event');

  return JSON.parse(lines[0]) as Record<string, unknown>;
};

describe('REDACT_PATHS', () => {
  const covers = (path: string): boolean => REDACT_PATHS.includes(path);

  it('censors credentials arriving on the request', () => {
    expect(covers('req.headers.authorization')).toBe(true);
    expect(covers('req.headers.cookie')).toBe(true);
    expect(covers('res.headers["set-cookie"]')).toBe(true);
  });

  it('censors the webhook signature, which is a shared secret', () => {
    expect(covers('req.headers["stripe-signature"]')).toBe(true);
  });

  it.each([
    'password',
    'currentPassword',
    'newPassword',
    'accessToken',
    'refreshToken',
    'resetToken',
    'tokenHash',
    'cardNumber',
    'cvc',
  ])('censors %s at the top level and one level down', (key) => {
    expect(covers(key)).toBe(true);
    expect(covers(`*.${key}`)).toBe(true);
  });

  it.each([
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'AWS_SECRET_ACCESS_KEY',
    'SMTP_PASSWORD',
    'AWS_SESSION_TOKEN',
    'SEED_MANAGER_PASSWORD',
  ])('censors the configuration value %s', (key) => {
    expect(covers(key)).toBe(true);
    expect(covers(`*.${key}`)).toBe(true);
  });

  it('declares a censor rather than deleting the key', () => {
    expect(REDACTED).toBe('[redacted]');
  });

  it('covers every name on the shared secret list', () => {
    for (const name of SECRET_VARIABLES) {
      expect(covers(name)).toBe(true);
    }
  });

  it('lists no path twice', () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
  });
});

describe('REDACT_PATHS applied by pino', () => {
  it('censors the credentials on a logged request', () => {
    const line = logged({
      req: {
        headers: {
          authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig',
          cookie: 'session=abc',
          'stripe-signature': 't=1,v1=deadbeef',
          'user-agent': 'curl/8.0',
        },
        body: {
          email: 'ana@example.com',
          password: 'correct horse battery',
          refreshToken: 'refresh-token-value',
        },
      },
    });

    expect(line.req).toEqual({
      headers: {
        authorization: REDACTED,
        cookie: REDACTED,
        'stripe-signature': REDACTED,
        'user-agent': 'curl/8.0',
      },
      body: {
        email: 'ana@example.com',
        password: REDACTED,
        refreshToken: REDACTED,
      },
    });
  });

  it('censors a secret field one level down in a logged object', () => {
    const line = logged({
      user: { id: 'u-1', passwordHash: '$argon2id$v=19$m=19456' },
    });

    expect(line.user).toEqual({ id: 'u-1', passwordHash: REDACTED });
  });

  it('censors a configuration secret up to two levels down', () => {
    const line = logged({
      DATABASE_URL: 'postgresql://tshirt:hunter2@db:5432/store',
      config: { STRIPE_SECRET_KEY: 'sk_test_123' },
      boot: { env: { JWT_ACCESS_SECRET: 'a'.repeat(32), PORT: 3000 } },
    });

    expect(line.DATABASE_URL).toBe(REDACTED);
    expect(line.config).toEqual({ STRIPE_SECRET_KEY: REDACTED });
    expect(line.boot).toEqual({
      env: { JWT_ACCESS_SECRET: REDACTED, PORT: 3000 },
    });
  });
});
