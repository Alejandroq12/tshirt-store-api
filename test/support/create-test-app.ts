import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { ValidationProbeModule } from './validation-probe.module';

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule, ValidationProbeModule],
  }).compile();

  const app = moduleFixture.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();

  return app;
}
