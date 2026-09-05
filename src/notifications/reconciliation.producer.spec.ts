import type { Queue } from 'bullmq';

import { ReconciliationProducer } from './reconciliation.producer';
import {
  PROCESS_STRIPE_EVENT_JOB,
  RECONCILIATION_INTERVAL_MS,
  RECONCILIATION_SCHEDULER_ID,
  RETRYABLE_JOB_OPTIONS,
  SCAN_PENDING_JOB,
  type StripeReconciliationJob,
} from './stock-notification.queue';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

describe('ReconciliationProducer', () => {
  const upsertJobScheduler = jest.fn();
  const getJob = jest.fn();
  const add = jest.fn();
  const on = jest.fn();
  const queue = {
    upsertJobScheduler,
    getJob,
    add,
    client: Promise.resolve({ on }),
  } as unknown as Queue<StripeReconciliationJob | Record<string, never>>;
  const producer = new ReconciliationProducer(queue);
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    jest.clearAllMocks();
    upsertJobScheduler.mockResolvedValue({});
    getJob.mockResolvedValue(undefined);
    add.mockResolvedValue({ id: `stripe-${EVENT_ID}` });
  });

  it('registers one deterministic scheduled scan', async () => {
    await producer.onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      RECONCILIATION_SCHEDULER_ID,
      { every: RECONCILIATION_INTERVAL_MS },
      {
        name: SCAN_PENDING_JOB,
        data: {},
        opts: RETRYABLE_JOB_OPTIONS,
      },
    );
  });

  it('does not fail application bootstrap when Redis is temporarily unavailable', async () => {
    upsertJobScheduler.mockRejectedValue(new Error('Redis unavailable'));

    await expect(producer.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('registers the scan again once Redis becomes ready', async () => {
    upsertJobScheduler.mockRejectedValueOnce(new Error('Redis unavailable'));

    await producer.onApplicationBootstrap();
    await settle();

    expect(on).toHaveBeenCalledWith('ready', expect.any(Function));
    const [, reconnected] = on.mock.calls[0] as [string, () => void];
    upsertJobScheduler.mockClear();

    reconnected();
    await settle();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      RECONCILIATION_SCHEDULER_ID,
      { every: RECONCILIATION_INTERVAL_MS },
      {
        name: SCAN_PENDING_JOB,
        data: {},
        opts: RETRYABLE_JOB_OPTIONS,
      },
    );
  });

  it('enqueues the stored Stripe event id with retries and backoff', async () => {
    await producer.enqueueStripeEvents([EVENT_ID, EVENT_ID]);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      PROCESS_STRIPE_EVENT_JOB,
      { eventId: EVENT_ID },
      { ...RETRYABLE_JOB_OPTIONS, jobId: `stripe-${EVENT_ID}` },
    );
  });

  it('restarts a failed reconciliation job', async () => {
    const retry = jest.fn().mockResolvedValue(undefined);
    getJob.mockResolvedValue({
      isFailed: jest.fn().mockResolvedValue(true),
      retry,
    });

    await producer.enqueueStripeEvents([EVENT_ID]);

    expect(retry).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
  });

  it('does not propagate an enqueue failure', async () => {
    add.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      producer.enqueueStripeEvents([EVENT_ID]),
    ).resolves.toBeUndefined();
  });
});
