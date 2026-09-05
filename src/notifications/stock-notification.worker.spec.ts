import type { Job } from 'bullmq';

import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  SEND_STOCK_NOTIFICATION_JOB,
  type StockNotificationJob,
} from './stock-notification.queue';
import { StockNotificationWorker } from './stock-notification.worker';

const NOTIFICATION_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-04T12:00:00.000Z');

const job = (name = SEND_STOCK_NOTIFICATION_JOB) =>
  ({
    name,
    data: { notificationId: NOTIFICATION_ID },
  }) as Job<StockNotificationJob>;

describe('StockNotificationWorker', () => {
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const send = jest.fn();
  const prisma = {
    stockNotification: { findUnique, updateMany },
  } as unknown as PrismaService;
  const mail = { send } as unknown as MailService;
  const worker = new StockNotificationWorker(prisma, mail);

  const notification = {
    id: NOTIFICATION_ID,
    sentAt: null,
    client: { email: 'client@example.com' },
    product: {
      name: 'Classic Crew',
      skus: [{ stockQuantity: 2 }, { stockQuantity: 1 }],
      images: [{ url: 'https://cdn.example.com/classic.webp' }],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue(notification);
    send.mockResolvedValue(undefined);
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('sends the current recipient a product image and records the current stock', async () => {
    await worker.process(job());

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      select: {
        id: true,
        sentAt: true,
        client: { select: { email: true } },
        product: {
          select: {
            name: true,
            skus: { select: { stockQuantity: true } },
            images: {
              where: { isFallback: true },
              orderBy: [
                { isProductPrimary: 'desc' },
                { createdAt: 'asc' },
                { id: 'asc' },
              ],
              take: 1,
              select: { url: true },
            },
          },
        },
      },
    });
    expect(send).toHaveBeenCalledWith({
      to: 'client@example.com',
      subject: 'Classic Crew is low in stock',
      text: expect.stringContaining(
        'https://cdn.example.com/classic.webp',
      ) as string,
      html: expect.stringContaining(
        '<img src="https://cdn.example.com/classic.webp"',
      ) as string,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID, sentAt: null },
      data: { sentAt: expect.any(Date) as Date, stockAtSend: 3 },
    });
  });

  it('uses a fallback image when it is the best available product image', async () => {
    findUnique.mockResolvedValue({
      ...notification,
      product: {
        ...notification.product,
        images: [{ url: 'https://cdn.example.com/fallback.png' }],
      },
    });

    await worker.process(job());

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining(
          'https://cdn.example.com/fallback.png',
        ) as string,
      }),
    );
  });

  it('does not send a notification that is already complete', async () => {
    findUnique.mockResolvedValue({ ...notification, sentAt: NOW });

    await worker.process(job());

    expect(send).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not send when the outbox row no longer exists', async () => {
    findUnique.mockResolvedValue(null);

    await worker.process(job());

    expect(send).not.toHaveBeenCalled();
  });

  it('leaves the row pending and propagates an email failure for BullMQ to retry', async () => {
    const failure = new Error('SMTP unavailable');
    send.mockRejectedValue(failure);

    await expect(worker.process(job())).rejects.toBe(failure);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses to send without the required product image', async () => {
    findUnique.mockResolvedValue({
      ...notification,
      product: { ...notification.product, images: [] },
    });

    await expect(worker.process(job())).rejects.toThrow(
      'Low-stock product has no fallback image',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects jobs from an unknown queue protocol', async () => {
    await expect(worker.process(job('unknown'))).rejects.toThrow(
      'Unsupported stock notification job: unknown',
    );
  });
});
