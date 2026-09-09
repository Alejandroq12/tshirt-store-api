import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { config as loadEnvironmentFiles } from 'dotenv';

import { validateEnvironment } from '../src/config/env.validation';
import { validateSeedEnvironment } from '../src/config/seed-env.validation';
import { CATALOG } from './catalog';

loadEnvironmentFiles({ path: ['.env.seed', '.env'], quiet: true });

const prisma = new PrismaClient();

async function seed(): Promise<void> {
  const env = validateEnvironment(process.env);
  const seedEnv = validateSeedEnvironment(process.env);

  const email = seedEnv.SEED_MANAGER_EMAIL.toLowerCase();

  const passwordHash = await argon2.hash(seedEnv.SEED_MANAGER_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: env.PASSWORD_HASH_MEMORY_KIB,
    timeCost: env.PASSWORD_HASH_TIME_COST,
    parallelism: env.PASSWORD_HASH_PARALLELISM,
  });

  const manager = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: {
      email,
      passwordHash,
      firstName: 'Store',
      lastName: 'Manager',
      role: 'MANAGER',
    },
  });

  let productCount = 0;
  let skuCount = 0;

  for (const entry of CATALOG) {
    const category = await prisma.category.upsert({
      where: { slug: entry.slug },
      update: { name: entry.name },
      create: { name: entry.name, slug: entry.slug },
    });

    for (const product of entry.products) {
      const existing = await prisma.product.findFirst({
        where: { name: product.name },
        select: { id: true },
      });

      const record =
        existing ??
        (await prisma.product.create({
          data: {
            categoryId: category.id,
            name: product.name,
            description: product.description,
          },
          select: { id: true },
        }));
      productCount += 1;

      for (const sku of product.skus) {
        await prisma.productSku.upsert({
          where: { skuCode: sku.skuCode },
          update: { price: sku.price, stockQuantity: sku.stockQuantity },
          create: { productId: record.id, ...sku },
        });
        skuCount += 1;
      }
    }
  }

  console.log(`seeded manager    ${manager.email} (${manager.role})`);
  console.log(`seeded categories ${CATALOG.length}`);
  console.log(`seeded products   ${productCount} (all inactive)`);
  console.log(`seeded skus       ${skuCount}`);
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
