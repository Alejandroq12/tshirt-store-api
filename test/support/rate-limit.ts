import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

export function resetRateLimit(app: INestApplication): void {
  const storage = app.get<ThrottlerStorageService>(ThrottlerStorage);
  storage.onApplicationShutdown();
  storage.storage.clear();
}
