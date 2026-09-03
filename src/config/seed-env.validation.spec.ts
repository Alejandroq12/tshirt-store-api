import { validateEnvironment } from './env.validation';
import { validateSeedEnvironment } from './seed-env.validation';

const complete = (overrides: Record<string, string> = {}) => ({
  NODE_ENV: 'development',
  SEED_MANAGER_EMAIL: 'manager@tshirt-store.test',
  SEED_MANAGER_PASSWORD: 'manager-dev-password',
  ...overrides,
});

describe('validateSeedEnvironment', () => {
  it('accepts the values shipped in .env.seed.example, so a fresh clone can seed', () => {
    expect(() => validateSeedEnvironment(complete())).not.toThrow();
  });

  it.each([
    ['a missing email', { SEED_MANAGER_EMAIL: '' }, /SEED_MANAGER_EMAIL/],
    [
      'a malformed email',
      { SEED_MANAGER_EMAIL: 'not-an-email' },
      /SEED_MANAGER_EMAIL/,
    ],
    [
      'a short password',
      { SEED_MANAGER_PASSWORD: 'short' },
      /at least 8 characters/,
    ],
  ])('refuses %s', (_label, overrides, expected) => {
    expect(() => validateSeedEnvironment(complete(overrides))).toThrow(
      expected,
    );
  });

  describe('production', () => {
    it('refuses the password published in .env.seed.example', () => {
      expect(() =>
        validateSeedEnvironment(complete({ NODE_ENV: 'production' })),
      ).toThrow(/SEED_MANAGER_PASSWORD still holds the placeholder/);
    });

    it('accepts a real password', () => {
      expect(() =>
        validateSeedEnvironment(
          complete({
            NODE_ENV: 'production',
            SEED_MANAGER_PASSWORD: 'a-real-manager-password',
          }),
        ),
      ).not.toThrow();
    });
  });

  it('is not required by the runtime schema', () => {
    let message = '';
    try {
      validateEnvironment({});
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('SEED_MANAGER_EMAIL');
    expect(message).not.toContain('SEED_MANAGER_PASSWORD');
  });
});
