import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
} from '@nestjs/common/constants';
import {
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  busboyExceptions,
  multerExceptions,
} from '@nestjs/platform-express/multer/multer/multer.constants';
import { transformException } from '@nestjs/platform-express/multer/multer/multer.utils';
import { lastValueFrom, of, throwError } from 'rxjs';

import { REQUIRED_ABILITIES } from '../authorization/decorators/check-abilities.decorator';
import { AbilitiesGuard } from '../authorization/guards/abilities.guard';
import { ValidationProblemException } from '../common/problems';
import { IMAGE_MAX_BYTES } from '../storage/image-upload.constants';
import { ImagesController } from './images.controller';
import type { ImagesService } from './services/images.service';

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const metadataFor = (key: string): unknown => {
  const target = Object.getOwnPropertyDescriptor(
    ImagesController.prototype,
    'uploadProductImage',
  )?.value as object | undefined;

  if (!target) throw new Error('Missing uploadProductImage method');
  return Reflect.getMetadata(key, target) as unknown;
};

// Builds the error FileInterceptor rejects with, through the library's own
// transformation, so the spec breaks if that message format changes.
const multerError = (message: string, field?: string): unknown =>
  transformException(Object.assign(new Error(message), { field }));

const throughUploadInterceptor = async (
  handle: CallHandler['handle'],
): Promise<unknown> => {
  const [interceptor] = metadataFor(INTERCEPTORS_METADATA) as [NestInterceptor];
  return lastValueFrom(
    await interceptor.intercept({} as ExecutionContext, { handle }),
  );
};

describe('ImagesController', () => {
  const upload = jest.fn();
  const controller = new ImagesController({
    upload,
  } as unknown as ImagesService);
  const file = {
    buffer: PNG,
    mimetype: 'image/png',
    size: PNG.length,
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

  it('delegates a file at the size limit to the service', async () => {
    await controller.uploadProductImage(
      { productId: PRODUCT_ID },
      {},
      { ...file, size: IMAGE_MAX_BYTES },
    );

    expect(upload).toHaveBeenCalledWith(
      PRODUCT_ID,
      {},
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

  it('catches file-part errors outside FileInterceptor', () => {
    const interceptors = metadataFor(INTERCEPTORS_METADATA) as unknown[];

    expect(interceptors).toHaveLength(2);
    expect(interceptors[0]).toHaveProperty('intercept', expect.any(Function));
    expect(interceptors[1]).toEqual(expect.any(Function));
  });

  it.each([
    ['a file part under another name', 'photo'],
    ['a repeated file part', 'file'],
  ])('rejects %s as validation failure', async (_case, field) => {
    const rejection = throughUploadInterceptor(() =>
      throwError(() =>
        multerError(multerExceptions.LIMIT_UNEXPECTED_FILE, field),
      ),
    );

    await expect(rejection).rejects.toBeInstanceOf(ValidationProblemException);
    await expect(rejection).rejects.toMatchObject({
      problem: {
        status: 422,
        errors: [
          { field, message: 'only one file part, named file, is accepted' },
        ],
      },
    });
  });

  it('rejects a text part over the field size limit as validation failure', async () => {
    const rejection = throughUploadInterceptor(() =>
      throwError(() =>
        multerError(multerExceptions.LIMIT_FIELD_VALUE, 'skuIds'),
      ),
    );

    await expect(rejection).rejects.toBeInstanceOf(ValidationProblemException);
    await expect(rejection).rejects.toMatchObject({
      problem: {
        status: 422,
        errors: [{ field: 'skuIds', message: 'value is too long' }],
      },
    });
  });

  it.each([
    [
      'an oversized file',
      multerError(multerExceptions.LIMIT_FILE_SIZE, 'file'),
    ],
    ['an unsupported file', new UnsupportedMediaTypeException()],
    ['an unnamed part', multerError(multerExceptions.MISSING_FIELD_NAME)],
    [
      'a missing boundary',
      multerError(busboyExceptions.MULTIPART_BOUNDARY_NOT_FOUND),
    ],
    ['a missing file', new ValidationProblemException([])],
  ])('passes %s through unchanged', async (_case, error) => {
    await expect(
      throughUploadInterceptor(() => throwError(() => error)),
    ).rejects.toBe(error);
  });

  it('passes a successful upload through unchanged', async () => {
    const image = { id: 'image-id' };

    await expect(throughUploadInterceptor(() => of(image))).resolves.toBe(
      image,
    );
  });
});
