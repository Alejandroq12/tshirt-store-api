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
import {
  ValidationProblemException,
  type ValidationProblemError,
} from '../common/problems';
import { ProductIdParams } from '../products/products.dto';
import {
  IMAGE_MAX_BYTES,
  isSupportedImageType,
} from '../storage/image-upload.constants';
import { matchesImageSignature } from './image-signature';
import { UploadProductImageRequest } from './images.dto';
import { ImagesService } from './services/images.service';
import type { ImageAssetResponse } from './types/images.types';

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const FIRST_OVERSIZED_IMAGE_SIZE = IMAGE_MAX_BYTES + 1;

// Multer calls the filter before it reads the file, so only the declared type
// can be refused here; the handler checks the bytes once they are buffered.
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
// part, with BadRequestException('Unexpected field - <name>'), and a text part
// over busboy's 1 MB default with 'Field value too long - <name>'. The
// operation declares no 400, so either part is an invalid body and gets the
// same 422 as a missing `file` part, naming the part.
const INVALID_PARTS: ReadonlyArray<{ prefix: string; message: string }> = [
  {
    prefix: `${multerExceptions.LIMIT_UNEXPECTED_FILE} - `,
    message: 'only one file part, named file, is accepted',
  },
  {
    prefix: `${multerExceptions.LIMIT_FIELD_VALUE} - `,
    message: 'value is too long',
  },
];

const invalidPart = (error: unknown): ValidationProblemError | undefined => {
  if (!(error instanceof BadRequestException)) return undefined;
  const match = INVALID_PARTS.find(({ prefix }) =>
    error.message.startsWith(prefix),
  );
  if (match === undefined) return undefined;
  return {
    field: error.message.slice(match.prefix.length),
    message: match.message,
  };
};

const INVALID_PART_AS_VALIDATION: NestInterceptor = {
  intercept: (_context, next) =>
    next.handle().pipe(
      catchError((error: unknown) => {
        const part = invalidPart(error);
        return throwError(() =>
          part === undefined ? error : new ValidationProblemException([part]),
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
    INVALID_PART_AS_VALIDATION,
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
    // The declared type becomes the stored object's Content-Type, so the bytes
    // must carry that type's signature, not merely some image signature.
    if (
      !isSupportedImageType(file.mimetype) ||
      !matchesImageSignature(file.buffer, file.mimetype)
    ) {
      throw new UnsupportedMediaTypeException();
    }

    return this.images.upload(productId, input, {
      body: file.buffer,
      contentType: file.mimetype,
    });
  }
}
