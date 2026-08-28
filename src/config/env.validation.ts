import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  Validate,
  ValidationError,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';

import { isPublishedPlaceholder } from './published-placeholders';

export const placeholderMessage = (variable: string): string =>
  `${variable} still holds the placeholder from .env.example, which is published in this repository and is not a secret`;

export enum NodeEnvironment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
  Silent = 'silent',
}

const DURATION = /^\d+(ms|s|m|h|d|w|y)$/;

const STRIPE_API_VERSION = /^\d{4}-\d{2}-\d{2}(\.[a-z]+)?$/;

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
};

const toTrustProxy = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'false') return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value;
};

const IsTrustProxy = () =>
  Validate(TrustProxyConstraint, {
    message:
      'TRUST_PROXY must be false, or the number of reverse proxies in front of the app (true is rejected: it makes the client IP spoofable)',
  });

@ValidatorConstraint({ name: 'trustProxy' })
class TrustProxyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === false) return true;
    return Number.isInteger(value) && (value as number) >= 0;
  }
}

export class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV!: NodeEnvironment;

  @Type(() => Number)
  @IsInt({ message: 'PORT must be an integer' })
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsEnum(LogLevel)
  LOG_LEVEL!: LogLevel;

  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  })
  DATABASE_URL!: string;

  @Matches(/^rediss?:\/\/.+/, {
    message: 'REDIS_URL must be a redis:// or rediss:// connection string',
  })
  REDIS_URL!: string;

  @IsString()
  @IsNotEmpty()
  CORS_ALLOWED_ORIGINS!: string;

  @Transform(toTrustProxy)
  @IsTrustProxy()
  TRUST_PROXY!: false | number;

  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET must be at least 32 characters',
  })
  JWT_ACCESS_SECRET!: string;

  @Matches(DURATION, {
    message: 'JWT_ACCESS_TTL must be a duration such as 15m or 3600s',
  })
  JWT_ACCESS_TTL!: string;

  @MinLength(32, {
    message: 'JWT_REFRESH_SECRET must be at least 32 characters',
  })
  JWT_REFRESH_SECRET!: string;

  @Matches(DURATION, {
    message: 'JWT_REFRESH_TTL must be a duration such as 30d',
  })
  JWT_REFRESH_TTL!: string;

  @Matches(DURATION, {
    message: 'PASSWORD_RESET_TOKEN_TTL must be a duration such as 1h',
  })
  PASSWORD_RESET_TOKEN_TTL!: string;

  @Type(() => Number)
  @IsInt({ message: 'PASSWORD_HASH_MEMORY_KIB must be an integer' })
  @Min(8192, {
    message:
      'PASSWORD_HASH_MEMORY_KIB below 8192 (8 MiB) is weaker than OWASP advises',
  })
  PASSWORD_HASH_MEMORY_KIB!: number;

  @Type(() => Number)
  @IsInt({ message: 'PASSWORD_HASH_TIME_COST must be an integer' })
  @Min(2, { message: 'PASSWORD_HASH_TIME_COST must be at least 2' })
  PASSWORD_HASH_TIME_COST!: number;

  @Type(() => Number)
  @IsInt({ message: 'PASSWORD_HASH_PARALLELISM must be an integer' })
  @Min(1)
  @Max(16)
  PASSWORD_HASH_PARALLELISM!: number;

  @Type(() => Number)
  @IsInt({ message: 'PASSWORD_RESET_RATE_LIMIT must be an integer' })
  @Min(1)
  PASSWORD_RESET_RATE_LIMIT!: number;

  @Type(() => Number)
  @IsInt({ message: 'PASSWORD_RESET_RATE_TTL_SECONDS must be an integer' })
  @Min(1)
  PASSWORD_RESET_RATE_TTL_SECONDS!: number;

  @Matches(/^[A-Z]{3}$/, {
    message: 'STORE_CURRENCY must be an ISO 4217 code such as USD',
  })
  STORE_CURRENCY!: string;

  @IsString()
  @IsNotEmpty()
  SMTP_HOST!: string;

  @Type(() => Number)
  @IsInt({ message: 'SMTP_PORT must be an integer' })
  @Min(1)
  @Max(65535)
  SMTP_PORT!: number;

  @Transform(toBoolean)
  @IsEnum([true, false], { message: 'SMTP_SECURE must be true or false' })
  SMTP_SECURE!: boolean;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsString()
  @IsNotEmpty()
  MAIL_FROM!: string;

  @IsString()
  @IsNotEmpty()
  AWS_REGION!: string;

  @IsString()
  @IsNotEmpty()
  AWS_S3_BUCKET!: string;

  @IsOptional()
  @IsString()
  AWS_S3_PUBLIC_BASE_URL?: string;

  @IsOptional()
  @IsString()
  AWS_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  AWS_SECRET_ACCESS_KEY?: string;

  @IsString()
  @IsNotEmpty()
  STRIPE_SECRET_KEY!: string;

  @IsString()
  @IsNotEmpty()
  STRIPE_WEBHOOK_SECRET!: string;

  @Matches(STRIPE_API_VERSION, {
    message:
      'STRIPE_API_VERSION must be a pinned Stripe version such as 2026-08-26.dahlia',
  })
  STRIPE_API_VERSION!: string;
}

const DEFAULTS: Record<string, string> = {
  TRUST_PROXY: 'false',
  NODE_ENV: NodeEnvironment.Development,
  PORT: '3000',
  LOG_LEVEL: LogLevel.Info,
  PASSWORD_HASH_MEMORY_KIB: '19456',
  PASSWORD_HASH_TIME_COST: '2',
  PASSWORD_HASH_PARALLELISM: '1',
  PASSWORD_RESET_RATE_LIMIT: '5',
  PASSWORD_RESET_RATE_TTL_SECONDS: '900',
  SMTP_SECURE: 'false',
};

const withoutBlanks = (
  config: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(config).filter(
      ([, value]) => !(typeof value === 'string' && value.trim() === ''),
    ),
  );

const CONSTRAINT_PRIORITY = [
  'isEnum',
  'isInt',
  'isNumber',
  'isBoolean',
  'isEmail',
  'matches',
  'isString',
  'isNotEmpty',
  'minLength',
  'maxLength',
];

const mostRelevantProblem = (error: ValidationError): string => {
  const constraints = error.constraints;
  if (!constraints) return `${error.property} is invalid`;

  const [firstKey] = Object.keys(constraints).sort((a, b) => {
    const rank = (key: string) => {
      const index = CONSTRAINT_PRIORITY.indexOf(key);
      return index === -1 ? CONSTRAINT_PRIORITY.length : index;
    };
    return rank(a) - rank(b);
  });

  return constraints[firstKey] ?? `${error.property} is invalid`;
};

type Invariant = (env: EnvironmentVariables) => string | undefined;

const halfConfigured = (first?: string, second?: string): boolean =>
  Boolean(first) !== Boolean(second);

const INVARIANTS: Invariant[] = [
  (env) =>
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
      ? 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ: sharing one secret means a refresh token verifies as an access token'
      : undefined,

  (env) =>
    halfConfigured(env.SMTP_USER, env.SMTP_PASSWORD)
      ? 'SMTP_USER and SMTP_PASSWORD must be set together or both left empty; one alone is ignored'
      : undefined,

  (env) =>
    halfConfigured(env.AWS_ACCESS_KEY_ID, env.AWS_SECRET_ACCESS_KEY)
      ? 'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together or both left empty; one alone is ignored'
      : undefined,
];

const PRODUCTION_INVARIANTS: Invariant[] = (
  [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'DATABASE_URL',
  ] as const
).map(
  (variable): Invariant =>
    (env) =>
      isPublishedPlaceholder(env[variable])
        ? placeholderMessage(variable)
        : undefined,
);

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const parsed = plainToInstance(EnvironmentVariables, {
    ...DEFAULTS,
    ...withoutBlanks(config),
  });

  const errors = validateSync(parsed, { skipMissingProperties: false });

  const problems = errors.map(mostRelevantProblem);

  if (problems.length === 0) {
    const applicable =
      parsed.NODE_ENV === NodeEnvironment.Production
        ? [...INVARIANTS, ...PRODUCTION_INVARIANTS]
        : INVARIANTS;

    for (const invariant of applicable) {
      const problem = invariant(parsed);
      if (problem !== undefined) problems.push(problem);
    }
  }

  if (problems.length > 0) {
    const listed = problems.sort().map((message) => `  - ${message}`);

    throw new Error(
      `Invalid environment configuration:\n${listed.join('\n')}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  return parsed;
}
