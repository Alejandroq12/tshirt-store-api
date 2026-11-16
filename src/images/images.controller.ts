import {
  BadRequestException,
  Body,
  Controller,
  type NestInterceptor,
  Param,
  PayloadTooLargeException,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileInterceptor,
  type MulterModuleOptions,
} from '@nestjs/platform-express';
import { multerExceptions } from '@nestjs/platform-express/multer/multer/multer.constants';
import { catchError, throwError } from 'rxjs';

import { CheckAbilities } from '../authorization/decorators/check-abilities.decorator';
import { ValidationProblemException } from '../common/problems';
import { ProductIdParams } from '../products/products.dto';
import {
  IMAGE_MAX_BYTES,
  isSupportedImageType,
} from '../storage/image-upload.constants';
import { UploadProductImageRequest } from './images.dto';
import { ImagesService } from './services/images.service';
import type { ImageAssetResponse } from './types/images.types';

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const FIRST_OVERSIZED_IMAGE_SIZE = IMAGE_MAX_BYTES + 1;

const IMAGE_UPLOAD_OPTIONS: MulterModuleOptions = {
  limits: { fileSize: FIRST_OVERSIZED_IMAGE_SIZE },
  fileFilter: (_request, file, callback) => {
    if (!isSupportedImageType(file.mimetype)) {
      callback(new UnsupportedMediaTypeException(), false);
      return;
    }
    callback(null, true);
  },
};

// FileInterceptor answers a file part under another name, or a second `file`
// part, with BadRequestException('Unexpected field - <name>'). The operation
// declares no 400, so that part is an invalid body and gets the same 422 as a
// missing `file` part.
const UNEXPECTED_FILE_PART = `${multerExceptions.LIMIT_UNEXPECTED_FILE} - `;

const unexpectedFilePart = (error: unknown): string | undefined =>
  error instanceof BadRequestException &&
  error.message.startsWith(UNEXPECTED_FILE_PART)
    ? error.message.slice(UNEXPECTED_FILE_PART.length)
    : undefined;

const UNEXPECTED_FILE_PART_AS_VALIDATION: NestInterceptor = {
  intercept: (_context, next) =>
    next.handle().pipe(
      catchError((error: unknown) => {
        const field = unexpectedFilePart(error);
        return throwError(() =>
          field === undefined
            ? error
            : new ValidationProblemException([
                {
                  field,
                  message: 'only one file part, named file, is accepted',
                },
              ]),
        );
      }),
    ),
};

@Controller('products/:productId/images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'ProductImage' })
  @UseInterceptors(
    UNEXPECTED_FILE_PART_AS_VALIDATION,
    FileInterceptor('file', IMAGE_UPLOAD_OPTIONS),
  )
  uploadProductImage(
    @Param() { productId }: ProductIdParams,
    @Body() input: UploadProductImageRequest,
    @UploadedFile() file?: UploadedImage,
  ): Promise<ImageAssetResponse> {
    if (!file) {
      throw new ValidationProblemException([
        { field: 'file', message: 'file is required' },
      ]);
    }
    if (file.size > IMAGE_MAX_BYTES) throw new PayloadTooLargeException();
    if (!isSupportedImageType(file.mimetype)) {
      throw new UnsupportedMediaTypeException();
    }

    return this.images.upload(productId, input, {
      body: file.buffer,
      contentType: file.mimetype,
    });
  }
}
