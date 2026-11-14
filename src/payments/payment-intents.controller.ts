import { Body, Controller, Post } from '@nestjs/common';

import type { SessionPrincipal } from '../auth/types/session-principal';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentIntentCreateRequest } from './payments.dto';
import { PaymentsService } from './services/payments.service';
import type { PaymentIntentResponse } from './types/payments.types';

@Controller('payment-intents')
export class PaymentIntentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  createPaymentIntent(
    @Body() input: PaymentIntentCreateRequest,
    @CurrentUser() user: SessionPrincipal,
  ): Promise<PaymentIntentResponse> {
    return this.payments.createIntent(input, user);
  }
}
