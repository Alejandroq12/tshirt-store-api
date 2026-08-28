import { PrismaClient } from '@prisma/client';

async function assertTestDatabase(prisma: PrismaClient): Promise<void> {
  const [{ database }] = await prisma.$queryRaw<{ database: string }[]>`
    SELECT current_database() AS database
  `;

  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to truncate "${database}": the end-to-end database must be ` +
        `named with a _test suffix. Check DATABASE_URL in .env.test, and that ` +
        `PrismaService is given that URL rather than reading the ambient one.`,
    );
  }
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await assertTestDatabase(prisma);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables
    .map(({ tablename }) => `"public"."${tablename}"`)
    .join(', ');

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
