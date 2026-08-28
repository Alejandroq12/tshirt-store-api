import { REDACT_PATHS, REDACTED, SECRET_VARIABLES } from './redaction';

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
