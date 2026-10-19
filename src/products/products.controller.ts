import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import type { SessionPrincipal } from '../auth/types/session-principal';
import { CheckAbilities } from '../authorization/decorators/check-abilities.decorator';
import { API_PREFIX } from '../bootstrap';
import { ValidationProblemException } from '../common/problems';
import {
  CreateProductRequest,
  LikeUpdateRequest,
  ListProductsQuery,
  ProductIdParams,
  UpdateProductRequest,
} from './products.dto';
import { ProductsService } from './services/products.service';
import type {
  LikeStateResponse,
  ProductDetailResponse,
  ProductPageResponse,
  ProductResponse,
} from './types/products.types';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @OptionalAuth()
  listProducts(
    @Query() query: ListProductsQuery,
    @CurrentUser({ optional: true }) user?: SessionPrincipal,
  ): Promise<ProductPageResponse> {
    return this.products.list(query, user);
  }

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Product' })
  async createProduct(
    @Body() input: CreateProductRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductResponse> {
    const product = await this.products.create(input);
    response.location(`/${API_PREFIX}/products/${product.id}`);
    return product;
  }

  @Get(':productId')
  @OptionalAuth()
  getProduct(
    @Param() { productId }: ProductIdParams,
    @CurrentUser({ optional: true }) user?: SessionPrincipal,
  ): Promise<ProductDetailResponse> {
    return this.products.get(productId, user);
  }

  @Patch(':productId')
  @CheckAbilities({ action: 'update', subject: 'Product' })
  updateProduct(
    @Param() { productId }: ProductIdParams,
    @Body() input: UpdateProductRequest,
  ): Promise<ProductResponse> {
    if (
      input.categoryId === undefined &&
      input.name === undefined &&
      input.description === undefined &&
      input.status === undefined
    ) {
      throw new ValidationProblemException([
        { field: '', message: 'At least one property is required.' },
      ]);
    }

    return this.products.update(productId, input);
  }

  @Patch(':productId/like')
  @CheckAbilities({ action: 'update', subject: 'ProductLike' })
  setProductLiked(
    @Param() { productId }: ProductIdParams,
    @Body() input: LikeUpdateRequest,
    @CurrentUser() user: SessionPrincipal,
  ): Promise<LikeStateResponse> {
    return this.products.setLiked(productId, input, user);
  }
}
