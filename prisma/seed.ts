import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { config as loadEnvironmentFiles } from 'dotenv';

import { validateEnvironment } from '../src/config/env.validation';
import { validateSeedEnvironment } from '../src/config/seed-env.validation';

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

  const category = await prisma.category.upsert({
    where: { slug: 't-shirts' },
    update: {},
    create: { name: 'T-Shirts', slug: 't-shirts' },
  });

  console.log(`seeded manager  ${manager.email} (${manager.role})`);
  console.log(`seeded category ${category.slug} (${category.name})`);
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
