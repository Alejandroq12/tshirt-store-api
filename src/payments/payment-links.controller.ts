import { Body, Controller, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckAbilities } from '../authorization/decorators/check-abilities.decorator';
import { PaymentLinkCreateRequest } from './payments.dto';
import { PaymentsService } from './services/payments.service';
import type { PaymentLinkResponse } from './types/payments.types';

@Controller('payment-links')
export class PaymentLinksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'PaymentLink' })
  createPaymentLink(
    @Body() input: PaymentLinkCreateRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentLinkResponse> {
    return this.payments.createLink(input, user);
  }
}
