import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidationError } from 'class-validator';
import type { Application } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';
import { SECRET_VARIABLES } from './logging/redaction';
import { createSecretScrubber } from './logging/secret-scrubber';
import {
  flattenValidationErrors,
  ValidationProblemException,
} from './common/problems';
import type { AppConfigService } from './config/config.module';

export const API_PREFIX = 'v1';

const parseOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

export function configureApp(app: INestApplication): INestApplication {
  const config = app.get<AppConfigService>(ConfigService);

  app.useLogger(app.get(Logger));

  app.setGlobalPrefix(API_PREFIX);

  const expressApp = app.getHttpAdapter().getInstance() as Application;
  expressApp.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));

  expressApp.use(helmet());

  app.enableCors({
    origin: parseOrigins(config.get('CORS_ALLOWED_ORIGINS', { infer: true })),
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new ValidationProblemException(flattenValidationErrors(errors)),
    }),
  );

  const scrubSecrets = createSecretScrubber(
    SECRET_VARIABLES.map((name) => process.env[name]),
  );

  app.useGlobalFilters(new ProblemExceptionFilter(scrubSecrets));

  return app;
}
