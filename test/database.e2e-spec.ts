import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './support/create-test-app';
import { truncateAll } from './support/database';
import {
  createClient,
  createProductWithSku,
  KNOWN_PASSWORD,
} from './support/fixtures';

describe('Database (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  describe('isolation', () => {
    it('starts every test from an empty database', async () => {
      await createClient(prisma);
      expect(await prisma.user.count()).toBe(1);

      await truncateAll(prisma);

      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.product.count()).toBe(0);
    });

    it('clears products, which no DELETE could do', async () => {
      await createProductWithSku(prisma);

      await truncateAll(prisma);

      expect(await prisma.product.count()).toBe(0);
    });
  });

  describe('the guard on truncation', () => {
    it('refuses a database that is not the end-to-end one', async () => {
      const elsewhere = new URL(process.env.DATABASE_URL!);
      elsewhere.pathname = '/postgres';

      const wrongDatabase = new PrismaClient({
        datasourceUrl: elsewhere.toString(),
      });

      try {
        await expect(truncateAll(wrongDatabase)).rejects.toThrow(
          /Refusing to truncate "postgres"/,
        );
      } finally {
        await wrongDatabase.$disconnect();
      }
    });
  });

  describe('fixtures', () => {
    it('creates a user whose password is known to the test', async () => {
      const user = await createClient(prisma);

      expect(user.role).toBe('CLIENT');
      expect(user.passwordHash).not.toBe(KNOWN_PASSWORD);
      expect(user.email).toBe(user.email.toLowerCase());
    });

    it('creates a product with one SKU and a known stock count', async () => {
      const { product, sku } = await createProductWithSku(prisma, {
        stockQuantity: 4,
      });

      expect(sku.productId).toBe(product.id);
      expect(sku.stockQuantity).toBe(4);
      expect(product.isActive).toBe(false);
    });

    it('keeps money as a decimal, never as a float', async () => {
      const { sku } = await createProductWithSku(prisma, { price: '19.99' });

      expect(sku.price).toBeInstanceOf(Prisma.Decimal);
      expect(sku.price.toString()).toBe('19.99');
    });
  });

  describe('constraints the application relies on instead of re-checking', () => {
    it('rejects a physical delete of a product', async () => {
      const { product } = await createProductWithSku(prisma);

      await expect(
        prisma.product.delete({ where: { id: product.id } }),
      ).rejects.toThrow(/cannot be physically deleted/i);

      expect(await prisma.product.count()).toBe(1);
    });

    it('rejects negative stock', async () => {
      const { sku } = await createProductWithSku(prisma, { stockQuantity: 1 });

      await expect(
        prisma.productSku.update({
          where: { id: sku.id },
          data: { stockQuantity: { decrement: 5 } },
        }),
      ).rejects.toThrow(/chk_skus_stock/);
    });

    it('rejects a duplicate SKU code across the whole store', async () => {
      const { sku } = await createProductWithSku(prisma);
      const { product } = await createProductWithSku(prisma);

      await expect(
        prisma.productSku.create({
          data: {
            productId: product.id,
            skuCode: sku.skuCode,
            size: 'L',
            color: 'red',
            price: '24.99',
            stockQuantity: 1,
          },
        }),
      ).rejects.toThrow(/uq_skus_code|Unique constraint/i);
    });

    it('rejects an email that is not lowercase', async () => {
      await expect(
        createClient(prisma).then(
          () =>
            prisma.$executeRaw`
            INSERT INTO users (email, password_hash, first_name, last_name)
            VALUES ('MixedCase@example.com', 'x', 'Ana', 'Rivera')
          `,
        ),
      ).rejects.toThrow(/chk_users_email_lower/);
    });

    it('allows only one pending order per client', async () => {
      const client = await createClient(prisma);

      const pending = {
        clientId: client.id,
        status: 'PENDING' as const,
        paymentMethod: 'PAYMENT_INTENT' as const,
        totalAmount: '19.99',
      };

      await prisma.order.create({ data: pending });

      await expect(prisma.order.create({ data: pending })).rejects.toThrow(
        /uq_one_pending_order|Unique constraint/i,
      );
    });
  });
});
