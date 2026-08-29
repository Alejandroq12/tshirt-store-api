import {
  Body,
  Controller,
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

import { CheckAbilities } from '../authorization/decorators/check-abilities.decorator';
import { ValidationProblemException } from '../common/problems';
import { ProductIdParams } from '../products/products.dto';
import {
  IMAGE_MAX_BYTES,
  isSupportedImageType,
} from '../storage/image-upload.constants';
import { UploadProductImageRequest } from './images.dto';
import { ImageAssetResponse, ImagesService } from './images.service';

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

@Controller('products/:productId/images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'ProductImage' })
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
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
