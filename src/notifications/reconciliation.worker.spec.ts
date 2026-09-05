import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';

import type { StripeWebhookService } from '../payments/stripe-webhook.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReconciliationProducer } from './reconciliation.producer';
import {
  PROCESS_STRIPE_EVENT_JOB,
  SCAN_PENDING_JOB,
  type StripeReconciliationJob,
} from './stock-notification.queue';
import type { StockNotificationProducer } from './stock-notification.producer';
import { ReconciliationWorker } from './reconciliation.worker';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const NOTIFICATION_ID = '22222222-2222-4222-8222-222222222222';

describe('ReconciliationWorker', () => {
  const queryRaw = jest.fn();
  const transaction = jest.fn();
  const processWebhook = jest.fn();
  const enqueueStripeEvents = jest.fn();
  const enqueueNotifications = jest.fn();
  const transactionClient = { $queryRaw: queryRaw };
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  const webhooks = {
    process: processWebhook,
  } as unknown as StripeWebhookService;
  const reconciliation = {
    enqueueStripeEvents,
  } as unknown as ReconciliationProducer;
  const notifications = {
    enqueue: enqueueNotifications,
  } as unknown as StockNotificationProducer;
  const worker = new ReconciliationWorker(
    prisma,
    webhooks,
    reconciliation,
    notifications,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation(
      (work: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        work(transactionClient as unknown as Prisma.TransactionClient),
    );
    queryRaw
      .mockResolvedValueOnce([{ id: EVENT_ID }])
      .mockResolvedValueOnce([{ id: NOTIFICATION_ID }]);
    processWebhook.mockResolvedValue(undefined);
    enqueueStripeEvents.mockResolvedValue(undefined);
    enqueueNotifications.mockResolvedValue(undefined);
  });

  it('scans and enqueues only pending rows while claiming them with SKIP LOCKED', async () => {
    await worker.process({
      name: SCAN_PENDING_JOB,
      data: {},
    } as Job<StripeReconciliationJob>);

    const queries = queryRaw.mock.calls.map(([query]: [Prisma.Sql]) =>
      query.strings.join(' '),
    );
    expect(queries[0]).toContain('FROM stripe_webhook_events');
    expect(queries[0]).toContain('processed_at IS NULL');
    expect(queries[0]).toContain('ORDER BY created_at, id');
    expect(queries[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(queries[1]).toContain('FROM stock_notifications');
    expect(queries[1]).toContain('sent_at IS NULL');
    expect(queries[1]).toContain('FOR UPDATE SKIP LOCKED');
    expect(enqueueStripeEvents).toHaveBeenCalledWith([EVENT_ID]);
    expect(enqueueNotifications).toHaveBeenCalledWith([NOTIFICATION_ID]);
  });

  it('reprocesses one durable Stripe event through the idempotent handler', async () => {
    await worker.process({
      name: PROCESS_STRIPE_EVENT_JOB,
      data: { eventId: EVENT_ID },
    } as Job<StripeReconciliationJob>);

    expect(processWebhook).toHaveBeenCalledWith(EVENT_ID);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('propagates processing failure so BullMQ applies retry and backoff', async () => {
    const failure = new Error('stock still unavailable');
    processWebhook.mockRejectedValue(failure);

    await expect(
      worker.process({
        name: PROCESS_STRIPE_EVENT_JOB,
        data: { eventId: EVENT_ID },
      } as Job<StripeReconciliationJob>),
    ).rejects.toBe(failure);
  });

  it('rejects jobs outside the reconciliation protocol', async () => {
    await expect(
      worker.process({
        name: 'unknown',
        data: {},
      } as Job<StripeReconciliationJob>),
    ).rejects.toThrow('Unsupported reconciliation job: unknown');
  });
});
