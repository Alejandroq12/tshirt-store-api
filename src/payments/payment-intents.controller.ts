import { Body, Controller, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentIntentCreateRequest } from './payments.dto';
import { PaymentIntentResponse, PaymentsService } from './payments.service';

@Controller('payment-intents')
export class PaymentIntentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  createPaymentIntent(
    @Body() input: PaymentIntentCreateRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentIntentResponse> {
    return this.payments.createIntent(input, user);
  }
}
