import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';

import { StripeWebhookService } from '../payments/stripe-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationProducer } from './reconciliation.producer';
import {
  PROCESS_STRIPE_EVENT_JOB,
  RECONCILIATION_QUEUE,
  SCAN_PENDING_JOB,
  type StripeReconciliationJob,
} from './stock-notification.queue';
import { StockNotificationProducer } from './stock-notification.producer';

const BATCH_SIZE = 100;

interface PendingRow {
  id: string;
}

@Injectable()
@Processor(RECONCILIATION_QUEUE, { concurrency: 1 })
export class ReconciliationWorker extends WorkerHost {
  private readonly logger = new Logger(ReconciliationWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: StripeWebhookService,
    private readonly reconciliation: ReconciliationProducer,
    private readonly notifications: StockNotificationProducer,
  ) {
    super();
  }

  async process(job: Job<StripeReconciliationJob>): Promise<void> {
    if (job.name === PROCESS_STRIPE_EVENT_JOB) {
      await this.webhooks.process(job.data.eventId);
      return;
    }
    if (job.name === SCAN_PENDING_JOB) {
      await this.scanPending();
      return;
    }

    throw new Error(`Unsupported reconciliation job: ${job.name}`);
  }

  private async scanPending(): Promise<void> {
    const [events, notifications] = await this.prisma.$transaction(
      async (transaction) => {
        const pendingEvents = await transaction.$queryRaw<PendingRow[]>(
          Prisma.sql`
            SELECT id
            FROM stripe_webhook_events
            WHERE processed_at IS NULL
            ORDER BY created_at, id
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
          `,
        );
        const pendingNotifications = await transaction.$queryRaw<PendingRow[]>(
          Prisma.sql`
            SELECT id
            FROM stock_notifications
            WHERE sent_at IS NULL
            ORDER BY id
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
          `,
        );

        return [pendingEvents, pendingNotifications] as const;
      },
    );

    await Promise.all([
      this.reconciliation.enqueueStripeEvents(events.map(({ id }) => id)),
      this.notifications.enqueue(notifications.map(({ id }) => id)),
    ]);

    this.logger.log(
      {
        pendingStripeEvents: events.length,
        pendingStockNotifications: notifications.length,
      },
      'reconciliation scan completed',
    );
  }
}
