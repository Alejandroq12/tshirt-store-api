import { plainToInstance } from 'class-transformer';
import { IsEmail, MinLength, validateSync } from 'class-validator';

import { NodeEnvironment, placeholderMessage } from './env.validation';
import { isPublishedPlaceholder } from './published-placeholders';

export class SeedEnvironmentVariables {
  @IsEmail({}, { message: 'SEED_MANAGER_EMAIL must be a valid email address' })
  SEED_MANAGER_EMAIL!: string;

  @MinLength(8, {
    message: 'SEED_MANAGER_PASSWORD must be at least 8 characters',
  })
  SEED_MANAGER_PASSWORD!: string;
}

export function validateSeedEnvironment(
  config: Record<string, unknown>,
): SeedEnvironmentVariables {
  const parsed = plainToInstance(SeedEnvironmentVariables, config);

  const problems = validateSync(parsed, {
    skipMissingProperties: false,
  }).flatMap((error) => Object.values(error.constraints ?? {}));

  const supplied = config.SEED_MANAGER_PASSWORD;

  if (
    config.NODE_ENV === NodeEnvironment.Production &&
    typeof supplied === 'string' &&
    isPublishedPlaceholder(supplied)
  ) {
    problems.push(placeholderMessage('SEED_MANAGER_PASSWORD'));
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid seed configuration:\n${problems
        .sort()
        .map((message) => `  - ${message}`)
        .join('\n')}\n`,
    );
  }

  return parsed;
}
