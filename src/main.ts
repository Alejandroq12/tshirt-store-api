import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import type { AppConfigService } from './config/config.module';
import { SECRET_VARIABLES } from './logging/redaction';
import { createSecretScrubber } from './logging/secret-scrubber';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
    abortOnError: false,
    autoFlushLogs: false,
  });

  configureApp(app);

  app.flushLogs();

  app.enableShutdownHooks();

  const config = app.get<AppConfigService>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap().catch((error: unknown) => {
  const scrub = createSecretScrubber(
    SECRET_VARIABLES.map((name) => process.env[name]),
  );

  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      msg: 'application failed to start',
      detail: scrub(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    })}\n`,
  );

  process.exitCode = 1;
});
