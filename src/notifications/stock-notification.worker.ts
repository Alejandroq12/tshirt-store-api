import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SEND_STOCK_NOTIFICATION_JOB,
  STOCK_NOTIFICATION_QUEUE,
  type StockNotificationJob,
} from './stock-notification.queue';

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );

@Injectable()
@Processor(STOCK_NOTIFICATION_QUEUE, { concurrency: 5 })
export class StockNotificationWorker extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {
    super();
  }

  async process(job: Job<StockNotificationJob>): Promise<void> {
    if (job.name !== SEND_STOCK_NOTIFICATION_JOB) {
      throw new Error(`Unsupported stock notification job: ${job.name}`);
    }

    const notification = await this.prisma.stockNotification.findUnique({
      where: { id: job.data.notificationId },
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

    if (!notification || notification.sentAt) return;

    const image = notification.product.images[0];
    if (!image) throw new Error('Low-stock product has no fallback image');

    const stockAtSend = notification.product.skus.reduce(
      (total, { stockQuantity }) => total + stockQuantity,
      0,
    );
    const productName = escapeHtml(notification.product.name);
    const imageUrl = escapeHtml(image.url);

    await this.mail.send({
      to: notification.client.email,
      subject: `${notification.product.name} is low in stock`,
      text: `${notification.product.name} is low in stock. Product image: ${image.url}`,
      html: `<p>${productName} is low in stock.</p><img src="${imageUrl}" alt="${productName}">`,
    });

    await this.prisma.stockNotification.updateMany({
      where: { id: notification.id, sentAt: null },
      data: { sentAt: new Date(), stockAtSend },
    });
  }
}
