import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { MailService } from '../../src/mail/mail.service';
import { S3StorageService } from '../../src/storage/s3-storage.service';
import { ValidationProbeModule } from './validation-probe.module';

interface TestAppOverrides {
  mail?: Pick<MailService, 'send'>;
  storage?: Pick<S3StorageService, 'upload' | 'remove'>;
}

export async function createTestApp(
  overrides: TestAppOverrides = {},
): Promise<INestApplication> {
  const builder = Test.createTestingModule({
    imports: [AppModule, ValidationProbeModule],
  });

  if (overrides.mail) {
    builder.overrideProvider(MailService).useValue(overrides.mail);
  }
  if (overrides.storage) {
    builder.overrideProvider(S3StorageService).useValue(overrides.storage);
  }

  const moduleFixture: TestingModule = await builder.compile();

  const app = moduleFixture.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();

  return app;
}
