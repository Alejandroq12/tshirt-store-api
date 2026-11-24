import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { ReconciliationProducer } from './reconciliation.producer';
import {
  PROCESS_STRIPE_EVENT_JOB,
  RECONCILIATION_INTERVAL_MS,
  RECONCILIATION_SCHEDULER_ID,
  RETRYABLE_JOB_OPTIONS,
  SCAN_PENDING_JOB,
  type StripeReconciliationJob,
} from '../stock-notification.queue';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT_ID = '22222222-2222-4222-8222-222222222222';

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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers one deterministic scheduled scan', async () => {
    producer.onApplicationBootstrap();
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

  it('returns from bootstrap without waiting for Redis', () => {
    upsertJobScheduler.mockReturnValue(new Promise(() => undefined));

    expect(producer.onApplicationBootstrap()).toBeUndefined();
  });

  it('does not fail application bootstrap when Redis is temporarily unavailable', async () => {
    upsertJobScheduler.mockRejectedValue(new Error('Redis unavailable'));

    producer.onApplicationBootstrap();

    await expect(settle()).resolves.toBeUndefined();
  });

  it('still registers the scan when it cannot follow Redis restarts', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const detached = new ReconciliationProducer({
      upsertJobScheduler,
      get client() {
        return Promise.reject(new Error('Redis unavailable'));
      },
    } as unknown as Queue<StripeReconciliationJob | Record<string, never>>);

    detached.onApplicationBootstrap();
    await settle();

    expect(upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'reconciliation schedule cannot follow Redis restarts',
    );
  });

  it('registers the scan again once Redis becomes ready', async () => {
    upsertJobScheduler.mockRejectedValueOnce(new Error('Redis unavailable'));

    producer.onApplicationBootstrap();
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

  it('neither duplicates nor restarts a job that is still queued', async () => {
    const retry = jest.fn();
    getJob.mockResolvedValue({
      isFailed: jest.fn().mockResolvedValue(false),
      retry,
    });

    await producer.enqueueStripeEvents([EVENT_ID]);

    expect(getJob).toHaveBeenCalledWith(`stripe-${EVENT_ID}`);
    expect(add).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('enqueues the other events when one of them fails', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    add.mockImplementation((_name: string, { eventId }: { eventId: string }) =>
      eventId === EVENT_ID
        ? Promise.reject(new Error('Redis unavailable'))
        : Promise.resolve({ id: `stripe-${eventId}` }),
    );

    await producer.enqueueStripeEvents([EVENT_ID, OTHER_EVENT_ID]);

    expect(add).toHaveBeenCalledWith(
      PROCESS_STRIPE_EVENT_JOB,
      { eventId: OTHER_EVENT_ID },
      { ...RETRYABLE_JOB_OPTIONS, jobId: `stripe-${OTHER_EVENT_ID}` },
    );
    expect(warn).toHaveBeenCalledWith(
      { requested: 2, failed: 1 },
      'Stripe reconciliation jobs were not enqueued',
    );
  });

  it('does not access Redis for an empty set', async () => {
    await producer.enqueueStripeEvents([]);

    expect(getJob).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});
