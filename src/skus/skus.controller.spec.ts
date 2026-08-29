import { GUARDS_METADATA } from '@nestjs/common/constants';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { IS_OPTIONAL_AUTH } from '../auth/decorators/optional-auth.decorator';
import { REQUIRED_ABILITIES } from '../authorization/decorators/check-abilities.decorator';
import { AbilitiesGuard } from '../authorization/guards/abilities.guard';
import { ValidationProblemException } from '../common/problems';
import { SkusController } from './skus.controller';
import { UpdateSkuRequest } from './skus.dto';
import type { SkusService } from './skus.service';

type MethodName = keyof Pick<
  SkusController,
  'createSku' | 'getSku' | 'updateSku'
>;

const metadataFor = (key: string, method: MethodName): unknown => {
  const target = Object.getOwnPropertyDescriptor(
    SkusController.prototype,
    method,
  )?.value as object | undefined;

  if (!target) throw new Error(`Missing controller method: ${method}`);
  return Reflect.getMetadata(key, target) as unknown;
};

const SKU = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  skuCode: 'CREW-BLUE-M',
  size: 'M',
  color: 'Blue',
  price: '19.90',
  currency: 'USD',
  stockQuantity: 4,
  createdAt: '2026-08-28T12:00:00.000Z',
  updatedAt: '2026-08-28T12:00:00.000Z',
};

describe('SkusController', () => {
  const skus = {
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
  };
  const controller = new SkusController(skus as unknown as SkusService);
  const manager: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'MANAGER',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    skus.create.mockResolvedValue(SKU);
  });

  it('delegates all three operations and sets the creation location', async () => {
    const create = {
      productId: SKU.productId,
      skuCode: SKU.skuCode,
      size: SKU.size,
      color: SKU.color,
      price: SKU.price,
      stockQuantity: SKU.stockQuantity,
    };
    const update = { stockQuantity: 8 };
    const response = { location: jest.fn() };

    await controller.createSku(create, response as never);
    await controller.getSku({ skuId: SKU.id }, manager);
    await controller.updateSku({ skuId: SKU.id }, update);

    expect(skus.create).toHaveBeenCalledWith(create);
    expect(response.location).toHaveBeenCalledWith(`/v1/skus/${SKU.id}`);
    expect(skus.get).toHaveBeenCalledWith(SKU.id, manager);
    expect(skus.update).toHaveBeenCalledWith(SKU.id, update);
  });

  it('marks only the read as optional authentication', () => {
    expect(metadataFor(IS_OPTIONAL_AUTH, 'getSku')).toBe(true);
    expect(metadataFor(IS_OPTIONAL_AUTH, 'createSku')).toBeUndefined();
    expect(metadataFor(IS_OPTIONAL_AUTH, 'updateSku')).toBeUndefined();
  });

  it('requires the exact CASL abilities on writes', () => {
    expect(metadataFor(REQUIRED_ABILITIES, 'createSku')).toEqual([
      { action: 'create', subject: 'ProductSku' },
    ]);
    expect(metadataFor(REQUIRED_ABILITIES, 'updateSku')).toEqual([
      { action: 'update', subject: 'ProductSku' },
    ]);
    expect(metadataFor(GUARDS_METADATA, 'createSku')).toContain(AbilitiesGuard);
    expect(metadataFor(GUARDS_METADATA, 'updateSku')).toContain(AbilitiesGuard);
  });

  it('rejects an empty transformed update before calling the service', () => {
    const input = new UpdateSkuRequest();

    expect(() => controller.updateSku({ skuId: SKU.id }, input)).toThrow(
      ValidationProblemException,
    );
    expect(skus.update).not.toHaveBeenCalled();
  });
});
