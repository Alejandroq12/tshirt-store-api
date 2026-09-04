import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuthorizationModule } from '../authorization/authorization.module';
import { CaslAbilityFactory } from '../authorization/casl-ability.factory';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentIntentsController } from './payment-intents.controller';
import { PaymentLinksController } from './payment-links.controller';
import { PaymentsService } from './payments.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeClient } from './stripe.client';

@Injectable()
class PaymentsAbilityRegistrar implements OnModuleInit {
  constructor(private readonly abilities: CaslAbilityFactory) {}

  onModuleInit(): void {
    this.abilities.register((user, { can }) => {
      if (user.role === UserRole.MANAGER) can('create', 'PaymentLink');
    });
  }
}

@Module({
  imports: [AuthorizationModule, PrismaModule],
  controllers: [
    PaymentLinksController,
    PaymentIntentsController,
    StripeWebhookController,
  ],
  providers: [
    PaymentsService,
    StripeWebhookService,
    StripeClient,
    PaymentsAbilityRegistrar,
  ],
  exports: [StripeWebhookService],
})
export class PaymentsModule {}
