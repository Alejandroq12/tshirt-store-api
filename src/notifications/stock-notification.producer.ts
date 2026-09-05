import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';

import {
  RETRYABLE_JOB_OPTIONS,
  SEND_STOCK_NOTIFICATION_JOB,
  STOCK_NOTIFICATION_QUEUE,
  type StockNotificationJob,
} from './stock-notification.queue';

@Injectable()
export class StockNotificationProducer {
  private readonly logger = new Logger(StockNotificationProducer.name);

  constructor(
    @InjectQueue(STOCK_NOTIFICATION_QUEUE)
    private readonly queue: Queue<StockNotificationJob>,
  ) {}

  async enqueue(notificationIds: string[]): Promise<void> {
    const ids = [...new Set(notificationIds)].sort();
    if (ids.length === 0) return;

    const results = await Promise.allSettled(
      ids.map((notificationId) => this.enqueueOne(notificationId)),
    );
    const failed = results.filter(({ status }) => status === 'rejected').length;

    if (failed > 0) {
      this.logger.warn(
        { requested: ids.length, failed },
        'stock notification jobs were not enqueued',
      );
    }
  }

  private async enqueueOne(notificationId: string): Promise<void> {
    const existing = await this.queue.getJob(notificationId);
    if (existing) {
      if (await existing.isFailed()) await this.retry(existing);
      return;
    }

    await this.queue.add(
      SEND_STOCK_NOTIFICATION_JOB,
      { notificationId },
      { ...RETRYABLE_JOB_OPTIONS, jobId: notificationId },
    );
  }

  private async retry(job: Job<StockNotificationJob>): Promise<void> {
    await job.retry('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
  }
}
