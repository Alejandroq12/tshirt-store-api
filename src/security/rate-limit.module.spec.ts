import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../config/env.validation';
import { buildThrottlerOptions } from './rate-limit.module';

const configWith = (values: Partial<EnvironmentVariables>) =>
  ({
    get: (key: keyof EnvironmentVariables) => values[key],
  }) as unknown as ConfigService<EnvironmentVariables, true>;

const optionsFor = (limit: number, ttlSeconds: number) => {
  const built = buildThrottlerOptions(
    configWith({
      PASSWORD_RESET_RATE_LIMIT: limit,
      PASSWORD_RESET_RATE_TTL_SECONDS: ttlSeconds,
    }),
  );

  return Array.isArray(built) ? { throttlers: built } : built;
};

describe('buildThrottlerOptions', () => {
  it('keeps the throttler named default', () => {
    expect(optionsFor(5, 900).throttlers[0]).toMatchObject({ name: 'default' });
  });

  it('converts the window from seconds to the milliseconds the library wants', () => {
    expect(optionsFor(5, 900).throttlers[0]).toMatchObject({ ttl: 900_000 });
  });

  it('takes the limit from configuration rather than a constant', () => {
    expect(optionsFor(3, 60).throttlers[0]).toMatchObject({ limit: 3 });
    expect(optionsFor(50, 60).throttlers[0]).toMatchObject({ limit: 50 });
  });

  it('replaces the library message, which names its own exception class', () => {
    const { errorMessage } = optionsFor(5, 900) as { errorMessage: string };

    expect(errorMessage).toBe(
      'Too many password-reset requests. Try again later.',
    );
    expect(errorMessage).not.toContain('ThrottlerException');
  });

  it('configures exactly one throttler', () => {
    expect(optionsFor(5, 900).throttlers).toHaveLength(1);
  });
});
