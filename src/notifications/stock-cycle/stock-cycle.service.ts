import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const LOW_STOCK_THRESHOLD = 3;

interface NotificationId {
  id: string;
}

@Injectable()
export class StockCycleService {
  async totalStock(
    transaction: Prisma.TransactionClient,
    productId: string,
  ): Promise<number> {
    const stock = await transaction.productSku.aggregate({
      where: { productId },
      _sum: { stockQuantity: true },
    });

    return stock._sum.stockQuantity ?? 0;
  }

  async evaluate(
    transaction: Prisma.TransactionClient,
    productId: string,
    totalBefore: number,
    totalAfter: number,
  ): Promise<string[]> {
    if (
      totalBefore > LOW_STOCK_THRESHOLD &&
      totalAfter <= LOW_STOCK_THRESHOLD
    ) {
      const notifications = await transaction.$queryRaw<NotificationId[]>(
        Prisma.sql`
          INSERT INTO stock_notifications (
            client_id,
            product_id,
            low_stock_cycle,
            stock_at_send,
            sent_at
          )
          SELECT
            pl.client_id,
            p.id,
            p.low_stock_cycle,
            NULL,
            NULL
          FROM products p
          JOIN product_likes pl ON pl.product_id = p.id
          JOIN users u ON u.id = pl.client_id
          WHERE p.id = ${productId}::uuid
            AND u.role = 'CLIENT'
            AND NOT EXISTS (
              SELECT 1
              FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
              WHERE oi.product_id = p.id
                AND o.client_id = pl.client_id
                AND o.paid_at IS NOT NULL
                AND o.status <> 'CANCELLED'
            )
          ON CONFLICT (client_id, product_id, low_stock_cycle) DO NOTHING
          RETURNING id
        `,
      );

      return notifications.map(({ id }) => id);
    }

    if (
      totalBefore <= LOW_STOCK_THRESHOLD &&
      totalAfter > LOW_STOCK_THRESHOLD
    ) {
      await transaction.product.update({
        where: { id: productId },
        data: { lowStockCycle: { increment: 1 } },
        select: { id: true },
      });
    }

    return [];
  }
}
