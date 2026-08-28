import { Module, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import type { AppConfigService } from '../config/config.module';
import { NodeEnvironment } from '../config/env.validation';
import { REDACT_PATHS, REDACTED } from './redaction';
import { correlationId, requestLogLevel } from './request-logging';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => {
        const isDevelopment =
          config.get('NODE_ENV', { infer: true }) ===
          NodeEnvironment.Development;

        return {
          forRoutes: [{ path: '*path', method: RequestMethod.ALL }],
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            genReqId: correlationId,
            redact: { paths: [...REDACT_PATHS], censor: REDACTED },
            customLogLevel: (_request, response, error) =>
              requestLogLevel(response, error),
            transport: isDevelopment
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
