import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { MailService } from '../../src/mail/mail.service';
import { ValidationProbeModule } from './validation-probe.module';

interface TestAppOverrides {
  mail?: Pick<MailService, 'send'>;
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

  const moduleFixture: TestingModule = await builder.compile();

  const app = moduleFixture.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();

  return app;
}
