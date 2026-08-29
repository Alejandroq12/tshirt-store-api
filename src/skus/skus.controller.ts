import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { CheckAbilities } from '../authorization/decorators/check-abilities.decorator';
import { API_PREFIX } from '../bootstrap';
import { ValidationProblemException } from '../common/problems';
import { CreateSkuRequest, SkuIdParams, UpdateSkuRequest } from './skus.dto';
import { SkuDetailResponse, SkuResponse, SkusService } from './skus.service';

@Controller('skus')
export class SkusController {
  constructor(private readonly skus: SkusService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'ProductSku' })
  async createSku(
    @Body() input: CreateSkuRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SkuResponse> {
    const sku = await this.skus.create(input);
    response.location(`/${API_PREFIX}/skus/${sku.id}`);
    return sku;
  }

  @Get(':skuId')
  @OptionalAuth()
  getSku(
    @Param() { skuId }: SkuIdParams,
    @CurrentUser({ optional: true }) user?: AuthenticatedUser,
  ): Promise<SkuDetailResponse> {
    return this.skus.get(skuId, user);
  }

  @Patch(':skuId')
  @CheckAbilities({ action: 'update', subject: 'ProductSku' })
  updateSku(
    @Param() { skuId }: SkuIdParams,
    @Body() input: UpdateSkuRequest,
  ): Promise<SkuResponse> {
    if (
      input.skuCode === undefined &&
      input.size === undefined &&
      input.color === undefined &&
      input.price === undefined &&
      input.stockQuantity === undefined
    ) {
      throw new ValidationProblemException([
        { field: '', message: 'At least one property is required.' },
      ]);
    }

    return this.skus.update(skuId, input);
  }
}
