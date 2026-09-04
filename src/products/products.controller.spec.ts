import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ValidationProblemException } from '../common/problems';
import { IS_OPTIONAL_AUTH } from '../auth/decorators/optional-auth.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { AbilitiesGuard } from '../authorization/guards/abilities.guard';
import { REQUIRED_ABILITIES } from '../authorization/decorators/check-abilities.decorator';
import { ProductsController } from './products.controller';
import { ProductStatus, UpdateProductRequest } from './products.dto';
import type { ProductsService } from './products.service';

type MethodName = keyof Pick<
  ProductsController,
  | 'listProducts'
  | 'createProduct'
  | 'getProduct'
  | 'updateProduct'
  | 'setProductLiked'
>;

const metadataFor = (key: string, method: MethodName): unknown => {
  const target = Object.getOwnPropertyDescriptor(
    ProductsController.prototype,
    method,
  )?.value as object | undefined;

  if (!target) throw new Error(`Missing controller method: ${method}`);
  return Reflect.getMetadata(key, target) as unknown;
};

const PRODUCT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  categoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'Classic Crew',
  description: null,
  status: ProductStatus.INACTIVE,
  retiredAt: null,
  createdAt: '2026-08-28T12:00:00.000Z',
  updatedAt: '2026-08-28T12:00:00.000Z',
};

describe('ProductsController', () => {
  const products = {
    list: jest.fn(),
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    setLiked: jest.fn(),
  };
  const controller = new ProductsController(
    products as unknown as ProductsService,
  );
  const manager: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'MANAGER',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };
  const client: AuthenticatedUser = {
    id: '33333333-3333-4333-8333-333333333333',
    role: 'CLIENT',
    sessionId: '44444444-4444-4444-8444-444444444444',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    products.create.mockResolvedValue(PRODUCT);
  });

  it('delegates all four operations and sets the creation location', async () => {
    const query = { limit: 20, offset: 0, category: 't-shirts' };
    const create = {
      categoryId: PRODUCT.categoryId,
      name: PRODUCT.name,
      description: null,
    };
    const update = { status: ProductStatus.ACTIVE };
    const response = { location: jest.fn() };

    await controller.listProducts(query, manager);
    await controller.createProduct(create, response as never);
    await controller.getProduct({ productId: PRODUCT.id }, manager);
    await controller.updateProduct({ productId: PRODUCT.id }, update);

    expect(products.list).toHaveBeenCalledWith(query, manager);
    expect(products.create).toHaveBeenCalledWith(create);
    expect(response.location).toHaveBeenCalledWith(
      `/v1/products/${PRODUCT.id}`,
    );
    expect(products.get).toHaveBeenCalledWith(PRODUCT.id, manager);
    expect(products.update).toHaveBeenCalledWith(PRODUCT.id, update);
  });

  it('marks exactly the two reads as optional authentication', () => {
    expect(metadataFor(IS_OPTIONAL_AUTH, 'listProducts')).toBe(true);
    expect(metadataFor(IS_OPTIONAL_AUTH, 'getProduct')).toBe(true);
    expect(metadataFor(IS_OPTIONAL_AUTH, 'createProduct')).toBeUndefined();
    expect(metadataFor(IS_OPTIONAL_AUTH, 'updateProduct')).toBeUndefined();
    expect(metadataFor(IS_OPTIONAL_AUTH, 'setProductLiked')).toBeUndefined();
  });

  it('requires the exact CASL abilities on writes', () => {
    expect(metadataFor(REQUIRED_ABILITIES, 'createProduct')).toEqual([
      { action: 'create', subject: 'Product' },
    ]);
    expect(metadataFor(REQUIRED_ABILITIES, 'updateProduct')).toEqual([
      { action: 'update', subject: 'Product' },
    ]);
    expect(metadataFor(REQUIRED_ABILITIES, 'setProductLiked')).toEqual([
      { action: 'update', subject: 'ProductLike' },
    ]);
    expect(metadataFor(GUARDS_METADATA, 'createProduct')).toContain(
      AbilitiesGuard,
    );
    expect(metadataFor(GUARDS_METADATA, 'updateProduct')).toContain(
      AbilitiesGuard,
    );
    expect(metadataFor(GUARDS_METADATA, 'setProductLiked')).toContain(
      AbilitiesGuard,
    );
  });

  it('passes the caller and requested liked state to the service', async () => {
    products.setLiked.mockResolvedValue({
      productId: PRODUCT.id,
      liked: true,
    });

    await expect(
      controller.setProductLiked(
        { productId: PRODUCT.id },
        { liked: true },
        client,
      ),
    ).resolves.toEqual({ productId: PRODUCT.id, liked: true });
    expect(products.setLiked).toHaveBeenCalledWith(
      PRODUCT.id,
      { liked: true },
      client,
    );
  });

  it('rejects an empty update before calling the service', () => {
    const input = new UpdateProductRequest();

    expect(() =>
      controller.updateProduct({ productId: PRODUCT.id }, input),
    ).toThrow(ValidationProblemException);
    expect(products.update).not.toHaveBeenCalled();
  });
});
