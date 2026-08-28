import {
  LogLevel,
  NodeEnvironment,
  validateEnvironment,
} from './env.validation';

const completeEnvironment = (): Record<string, string> => ({
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://tshirt:tshirt@localhost:5432/tshirt_store',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_REFRESH_TTL: '30d',
  PASSWORD_RESET_TOKEN_TTL: '1h',
  PASSWORD_HASH_MEMORY_KIB: '19456',
  PASSWORD_HASH_TIME_COST: '2',
  PASSWORD_HASH_PARALLELISM: '1',
  PASSWORD_RESET_RATE_LIMIT: '5',
  PASSWORD_RESET_RATE_TTL_SECONDS: '900',
  STORE_CURRENCY: 'USD',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  MAIL_FROM: 'T-Shirt Store <no-reply@tshirt-store.test>',
  AWS_REGION: 'us-east-1',
  AWS_S3_BUCKET: 'tshirt-store-images-dev',
  STRIPE_SECRET_KEY: 'sk_test_replace_me',
  STRIPE_WEBHOOK_SECRET: 'whsec_replace_me',
  STRIPE_API_VERSION: '2026-08-26.dahlia',
});

describe('validateEnvironment', () => {
  it('accepts a complete configuration', () => {
    expect(() => validateEnvironment(completeEnvironment())).not.toThrow();
  });

  it('coerces numeric variables away from strings', () => {
    const result = validateEnvironment(completeEnvironment());

    expect(result.PORT).toBe(3000);
    expect(result.PASSWORD_HASH_MEMORY_KIB).toBe(19456);
    expect(result.PASSWORD_RESET_RATE_TTL_SECONDS).toBe(900);
    expect(result.PASSWORD_HASH_MEMORY_KIB).toBe(19456);
  });

  it('reads SMTP_SECURE=false as false rather than as a truthy string', () => {
    const result = validateEnvironment({
      ...completeEnvironment(),
      SMTP_SECURE: 'false',
    });

    expect(result.SMTP_SECURE).toBe(false);
  });

  it('applies defaults only to variables that are safe to assume', () => {
    const {
      NODE_ENV: _nodeEnv,
      PORT: _port,
      LOG_LEVEL: _logLevel,
      PASSWORD_HASH_MEMORY_KIB: _memory,
      ...withoutDefaultable
    } = completeEnvironment();

    const result = validateEnvironment(withoutDefaultable);

    expect(result.NODE_ENV).toBe(NodeEnvironment.Development);
    expect(result.PORT).toBe(3000);
    expect(result.LOG_LEVEL).toBe(LogLevel.Info);
    expect(result.PASSWORD_HASH_MEMORY_KIB).toBe(19456);
  });

  it('names every missing variable in one error instead of one per restart', () => {
    const {
      DATABASE_URL: _databaseUrl,
      JWT_ACCESS_SECRET: _accessSecret,
      STORE_CURRENCY: _currency,
      ...incomplete
    } = completeEnvironment();

    expect(() => validateEnvironment(incomplete)).toThrow(
      /DATABASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*STORE_CURRENCY/,
    );
  });

  it('treats an empty assignment as a missing variable', () => {
    expect(() =>
      validateEnvironment({ ...completeEnvironment(), JWT_ACCESS_SECRET: '' }),
    ).toThrow(/JWT_ACCESS_SECRET must be at least 32 characters/);
  });

  it.each([
    [
      'DATABASE_URL',
      'mysql://localhost/tshirt',
      /DATABASE_URL must be a postgresql/,
    ],
    ['PORT', 'not-a-port', /PORT must be an integer/],
    ['STORE_CURRENCY', 'dollars', /STORE_CURRENCY must be an ISO 4217 code/],
    ['JWT_ACCESS_TTL', '15 minutes', /JWT_ACCESS_TTL must be a duration/],
    ['JWT_ACCESS_SECRET', 'too-short', /JWT_ACCESS_SECRET must be at least 32/],
    ['STRIPE_API_VERSION', 'latest', /STRIPE_API_VERSION must be a pinned/],
    ['LOG_LEVEL', 'verbose', /LOG_LEVEL/],
  ])('rejects a malformed %s', (variable, value, expected) => {
    expect(() =>
      validateEnvironment({ ...completeEnvironment(), [variable]: value }),
    ).toThrow(expected);
  });

  describe('TRUST_PROXY', () => {
    it('defaults to not trusting any proxy', () => {
      const { ...withoutTrustProxy } = completeEnvironment();
      expect(validateEnvironment(withoutTrustProxy).TRUST_PROXY).toBe(false);
    });

    it('keeps a hop count as a number rather than reading it as true', () => {
      const result = validateEnvironment({
        ...completeEnvironment(),
        TRUST_PROXY: '1',
      });

      expect(result.TRUST_PROXY).toBe(1);
    });

    it('rejects true, because it makes the client IP spoofable', () => {
      expect(() =>
        validateEnvironment({ ...completeEnvironment(), TRUST_PROXY: 'true' }),
      ).toThrow(/TRUST_PROXY must be false, or the number of reverse proxies/);
    });

    it('rejects a value that is neither false nor a hop count', () => {
      expect(() =>
        validateEnvironment({ ...completeEnvironment(), TRUST_PROXY: 'yes' }),
      ).toThrow(/TRUST_PROXY/);
    });
  });

  describe('rules that span more than one variable', () => {
    it('refuses one secret used for both token kinds', () => {
      const shared = 'c'.repeat(32);

      expect(() =>
        validateEnvironment({
          ...completeEnvironment(),
          JWT_ACCESS_SECRET: shared,
          JWT_REFRESH_SECRET: shared,
        }),
      ).toThrow(/JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ/);
    });

    it.each([
      ['SMTP_USER', 'SMTP_PASSWORD'],
      ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    ])('refuses %s without %s', (first, second) => {
      expect(() =>
        validateEnvironment({ ...completeEnvironment(), [first]: 'value' }),
      ).toThrow(new RegExp(`${first} and ${second} must be set together`));

      expect(() =>
        validateEnvironment({ ...completeEnvironment(), [second]: 'value' }),
      ).toThrow(new RegExp(`${first} and ${second} must be set together`));
    });

    it('accepts both halves of a credential pair', () => {
      expect(() =>
        validateEnvironment({
          ...completeEnvironment(),
          SMTP_USER: 'apikey',
          SMTP_PASSWORD: 'secret',
        }),
      ).not.toThrow();
    });

    it('accepts neither half', () => {
      expect(() => validateEnvironment(completeEnvironment())).not.toThrow();
    });
  });

  describe('production', () => {
    const production = (overrides: Record<string, string> = {}) => ({
      ...completeEnvironment(),
      NODE_ENV: 'production',
      ...overrides,
    });

    it.each([
      [
        'JWT_ACCESS_SECRET',
        'dev-only-access-secret-replace-in-every-real-deployment',
      ],
      [
        'JWT_REFRESH_SECRET',
        'dev-only-refresh-secret-replace-in-every-real-deployment',
      ],
      ['STRIPE_SECRET_KEY', 'sk_test_replace_me'],
      ['STRIPE_WEBHOOK_SECRET', 'whsec_replace_me'],
      [
        'DATABASE_URL',
        'postgresql://tshirt:tshirt@localhost:5432/tshirt_store?schema=public',
      ],
    ])('refuses the published placeholder in %s', (variable, published) => {
      expect(() =>
        validateEnvironment(production({ [variable]: published })),
      ).toThrow(new RegExp(`${variable} still holds the placeholder`));
    });

    it('accepts real values', () => {
      expect(() =>
        validateEnvironment(
          production({
            JWT_ACCESS_SECRET: 'x'.repeat(48),
            JWT_REFRESH_SECRET: 'y'.repeat(48),
            STRIPE_SECRET_KEY: 'sk_live_realkey',
            STRIPE_WEBHOOK_SECRET: 'whsec_realsecret',
          }),
        ),
      ).not.toThrow();
    });

    it('leaves development alone, where the placeholders are the point', () => {
      expect(() => validateEnvironment(completeEnvironment())).not.toThrow();
    });

    it('still allows a Stripe test key, which a staging deploy needs', () => {
      expect(() =>
        validateEnvironment(
          production({
            JWT_ACCESS_SECRET: 'x'.repeat(48),
            JWT_REFRESH_SECRET: 'y'.repeat(48),
            STRIPE_SECRET_KEY: 'sk_test_51AbCdEf',
            STRIPE_WEBHOOK_SECRET: 'whsec_realsecret',
          }),
        ),
      ).not.toThrow();
    });
  });

  it('reports one problem per variable, not one per broken rule', () => {
    let message = '';
    try {
      validateEnvironment({ ...completeEnvironment(), PORT: 'abc' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('PORT must be an integer');
    expect(message).not.toContain('greater than 65535');
    expect(message).not.toContain('less than 1');
  });

  it('points the reader at the file that fixes it', () => {
    const { DATABASE_URL: _databaseUrl, ...incomplete } = completeEnvironment();

    expect(() => validateEnvironment(incomplete)).toThrow(
      /Copy \.env\.example to \.env/,
    );
  });
});
