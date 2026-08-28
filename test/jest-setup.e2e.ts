import { resolve } from 'node:path';

import { config as loadEnvironment } from 'dotenv';

loadEnvironment({
  path: resolve(__dirname, '..', '.env.test'),
  // Must override .env before Prisma is imported.
  override: true,
  quiet: true,
});

import './jest-setup.unit';
