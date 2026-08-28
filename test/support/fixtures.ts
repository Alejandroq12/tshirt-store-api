import {
  PrismaClient,
  type Product,
  type ProductSku,
  type User,
} from '@prisma/client';
import * as argon2 from 'argon2';

export const KNOWN_PASSWORD = 'example-password';

const FIXTURE_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 8192,
  timeCost: 2,
  parallelism: 1,
} as const;

let sequence = 0;
const unique = (prefix: string): string => `${prefix}-${(sequence += 1)}`;

export interface UserOverrides {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
}

const createUser = async (
  prisma: PrismaClient,
  role: 'MANAGER' | 'CLIENT',
  overrides: UserOverrides = {},
): Promise<User> =>
  prisma.user.create({
    data: {
      email: (
        overrides.email ?? `${unique(role.toLowerCase())}@example.com`
      ).toLowerCase(),
      passwordHash: await argon2.hash(
        overrides.password ?? KNOWN_PASSWORD,
        FIXTURE_HASH_OPTIONS,
      ),
      firstName: overrides.firstName ?? 'Ana',
      lastName: overrides.lastName ?? 'Rivera',
      role,
    },
  });

export const createClient = (prisma: PrismaClient, overrides?: UserOverrides) =>
  createUser(prisma, 'CLIENT', overrides);

export const createManager = (
  prisma: PrismaClient,
  overrides?: UserOverrides,
) => createUser(prisma, 'MANAGER', overrides);

export interface CatalogueOverrides {
  categorySlug?: string;
  productName?: string;
  isActive?: boolean;
  price?: string;
  stockQuantity?: number;
  size?: string;
  color?: string;
}

export interface SeededCatalogue {
  product: Product;
  sku: ProductSku;
}

export async function createProductWithSku(
  prisma: PrismaClient,
  overrides: CatalogueOverrides = {},
): Promise<SeededCatalogue> {
  const slug = overrides.categorySlug ?? 't-shirts';

  const category = await prisma.category.upsert({
    where: { slug },
    update: {},
    create: { name: slug, slug },
  });

  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      name: overrides.productName ?? unique('Classic Crew'),
      isActive: overrides.isActive ?? false,
    },
  });

  const sku = await prisma.productSku.create({
    data: {
      productId: product.id,
      skuCode: unique('SKU'),
      size: overrides.size ?? 'M',
      color: overrides.color ?? 'blue',
      price: overrides.price ?? '19.99',
      stockQuantity: overrides.stockQuantity ?? 10,
    },
  });

  return { product, sku };
}
