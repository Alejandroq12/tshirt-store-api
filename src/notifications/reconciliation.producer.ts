import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';

import {
  PROCESS_STRIPE_EVENT_JOB,
  RECONCILIATION_INTERVAL_MS,
  RECONCILIATION_QUEUE,
  RECONCILIATION_SCHEDULER_ID,
  RETRYABLE_JOB_OPTIONS,
  SCAN_PENDING_JOB,
  type StripeReconciliationJob,
} from './stock-notification.queue';

type ReconciliationJob = StripeReconciliationJob | Record<string, never>;

@Injectable()
export class ReconciliationProducer implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReconciliationProducer.name);

  constructor(
    @InjectQueue(RECONCILIATION_QUEUE)
    private readonly queue: Queue<ReconciliationJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        RECONCILIATION_SCHEDULER_ID,
        { every: RECONCILIATION_INTERVAL_MS },
        {
          name: SCAN_PENDING_JOB,
          data: {},
          opts: RETRYABLE_JOB_OPTIONS,
        },
      );
    } catch {
      this.logger.warn('reconciliation schedule was not registered');
    }
  }

  async enqueueStripeEvents(eventIds: string[]): Promise<void> {
    const ids = [...new Set(eventIds)].sort();
    if (ids.length === 0) return;

    const results = await Promise.allSettled(
      ids.map((eventId) => this.enqueueOne(eventId)),
    );
    const failed = results.filter(({ status }) => status === 'rejected').length;

    if (failed > 0) {
      this.logger.warn(
        { requested: ids.length, failed },
        'Stripe reconciliation jobs were not enqueued',
      );
    }
  }

  private async enqueueOne(eventId: string): Promise<void> {
    const jobId = `stripe-${eventId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      if (await existing.isFailed()) await this.retry(existing);
      return;
    }

    await this.queue.add(
      PROCESS_STRIPE_EVENT_JOB,
      { eventId },
      { ...RETRYABLE_JOB_OPTIONS, jobId },
    );
  }

  private async retry(job: Job<ReconciliationJob>): Promise<void> {
    await job.retry('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
  }
}
