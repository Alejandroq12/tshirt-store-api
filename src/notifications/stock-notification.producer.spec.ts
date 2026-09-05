import type { Queue } from 'bullmq';

import {
  RETRYABLE_JOB_OPTIONS,
  SEND_STOCK_NOTIFICATION_JOB,
  type StockNotificationJob,
} from './stock-notification.queue';
import { StockNotificationProducer } from './stock-notification.producer';

const NOTIFICATION_ID = '11111111-1111-4111-8111-111111111111';

describe('StockNotificationProducer', () => {
  const getJob = jest.fn();
  const add = jest.fn();
  const queue = { getJob, add } as unknown as Queue<StockNotificationJob>;
  const producer = new StockNotificationProducer(queue);

  beforeEach(() => {
    jest.clearAllMocks();
    getJob.mockResolvedValue(undefined);
    add.mockResolvedValue({ id: NOTIFICATION_ID });
  });

  it('enqueues only the stable notification id with retries and backoff', async () => {
    await producer.enqueue([NOTIFICATION_ID, NOTIFICATION_ID]);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      SEND_STOCK_NOTIFICATION_JOB,
      { notificationId: NOTIFICATION_ID },
      { ...RETRYABLE_JOB_OPTIONS, jobId: NOTIFICATION_ID },
    );
  });

  it('restarts an exhausted failed job so the database outbox can recover it', async () => {
    const retry = jest.fn().mockResolvedValue(undefined);
    getJob.mockResolvedValue({
      isFailed: jest.fn().mockResolvedValue(true),
      retry,
    });

    await producer.enqueue([NOTIFICATION_ID]);

    expect(retry).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('does not duplicate a waiting or active job', async () => {
    getJob.mockResolvedValue({
      isFailed: jest.fn().mockResolvedValue(false),
    });

    await producer.enqueue([NOTIFICATION_ID]);

    expect(add).not.toHaveBeenCalled();
  });

  it('does not propagate Redis failure after the database transaction committed', async () => {
    add.mockRejectedValue(new Error('Redis unavailable'));

    await expect(producer.enqueue([NOTIFICATION_ID])).resolves.toBeUndefined();
  });

  it('does not access Redis for an empty set', async () => {
    await producer.enqueue([]);

    expect(getJob).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});
