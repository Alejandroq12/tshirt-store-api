import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import type { EnvironmentVariables } from '../config/env.validation';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReconciliationProducer } from './reconciliation.producer';
import {
  RECONCILIATION_QUEUE,
  STOCK_NOTIFICATION_QUEUE,
} from './stock-notification.queue';
import { StockCycleService } from './stock-cycle.service';
import { StockNotificationProducer } from './stock-notification.producer';
import { StockNotificationWorker } from './stock-notification.worker';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
        prefix: `{tshirt-${config.get('NODE_ENV', { infer: true })}}`,
      }),
    }),
    BullModule.registerQueue(
      { name: STOCK_NOTIFICATION_QUEUE },
      { name: RECONCILIATION_QUEUE },
    ),
    PrismaModule,
    MailModule,
  ],
  providers: [
    StockCycleService,
    StockNotificationProducer,
    ReconciliationProducer,
    StockNotificationWorker,
  ],
  exports: [
    BullModule,
    StockCycleService,
    StockNotificationProducer,
    ReconciliationProducer,
  ],
})
export class NotificationsModule {}
