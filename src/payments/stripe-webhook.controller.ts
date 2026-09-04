import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(private readonly webhooks: StripeWebhookService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  receiveStripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<void> {
    return this.webhooks.receive(request.rawBody, signature);
  }
}
