import type { JobsOptions } from 'bullmq';

export const STOCK_NOTIFICATION_QUEUE = 'stock-notifications';
export const RECONCILIATION_QUEUE = 'reconciliation';

export const SEND_STOCK_NOTIFICATION_JOB = 'send-stock-notification';
export const SCAN_PENDING_JOB = 'scan-pending';
export const PROCESS_STRIPE_EVENT_JOB = 'process-stripe-event';

export const RECONCILIATION_SCHEDULER_ID = 'pending-reconciliation';
export const RECONCILIATION_INTERVAL_MS = 30_000;

export const RETRYABLE_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: true,
  removeOnFail: false,
} satisfies JobsOptions;

export interface StockNotificationJob {
  notificationId: string;
}

export interface StripeReconciliationJob {
  eventId: string;
}
