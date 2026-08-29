import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

import { REQUIRED_ABILITIES } from '../authorization/decorators/check-abilities.decorator';
import { AbilitiesGuard } from '../authorization/guards/abilities.guard';
import { ValidationProblemException } from '../common/problems';
import { IMAGE_MAX_BYTES } from '../storage/image-upload.constants';
import { ImagesController } from './images.controller';
import type { ImagesService } from './images.service';

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const metadataFor = (key: string): unknown => {
  const target = Object.getOwnPropertyDescriptor(
    ImagesController.prototype,
    'uploadProductImage',
  )?.value as object | undefined;

  if (!target) throw new Error('Missing uploadProductImage method');
  return Reflect.getMetadata(key, target) as unknown;
};

describe('ImagesController', () => {
  const upload = jest.fn();
  const controller = new ImagesController({
    upload,
  } as unknown as ImagesService);
  const file = {
    buffer: Buffer.from('image'),
    mimetype: 'image/png',
    size: 5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires the manager image-creation ability', () => {
    expect(metadataFor(REQUIRED_ABILITIES)).toEqual([
      { action: 'create', subject: 'ProductImage' },
    ]);
    expect(metadataFor(GUARDS_METADATA)).toContain(AbilitiesGuard);
  });

  it('delegates a supported upload to the service', async () => {
    await controller.uploadProductImage(
      { productId: PRODUCT_ID },
      { primary: true },
      file,
    );

    expect(upload).toHaveBeenCalledWith(
      PRODUCT_ID,
      { primary: true },
      { body: file.buffer, contentType: 'image/png' },
    );
  });

  it('rejects a missing file as validation failure', () => {
    expect(() =>
      controller.uploadProductImage({ productId: PRODUCT_ID }, {}),
    ).toThrow(ValidationProblemException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects oversized and unsupported files before the service', () => {
    expect(() =>
      controller.uploadProductImage(
        { productId: PRODUCT_ID },
        {},
        { ...file, size: IMAGE_MAX_BYTES + 1 },
      ),
    ).toThrow(PayloadTooLargeException);
    expect(() =>
      controller.uploadProductImage(
        { productId: PRODUCT_ID },
        {},
        { ...file, mimetype: 'image/gif' },
      ),
    ).toThrow(UnsupportedMediaTypeException);
    expect(upload).not.toHaveBeenCalled();
  });
});
