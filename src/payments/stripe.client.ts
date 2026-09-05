import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import type { EnvironmentVariables } from '../config/env.validation';

@Injectable()
export class StripeClient {
  private readonly client: Stripe;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.client = new Stripe(config.get('STRIPE_SECRET_KEY', { infer: true }), {
      apiVersion: config.get('STRIPE_API_VERSION', {
        infer: true,
      }),
      typescript: true,
    });
  }

  createPaymentLink(
    params: Stripe.PaymentLinkCreateParams,
  ): Promise<Stripe.PaymentLink> {
    return this.client.paymentLinks.create(params);
  }

  createPaymentIntent(
    params: Stripe.PaymentIntentCreateParams,
    options: Stripe.RequestOptions,
  ): Promise<Stripe.PaymentIntent> {
    return this.client.paymentIntents.create(params, options);
  }

  constructEvent(
    payload: Buffer,
    signature: string,
    secret: string,
  ): Stripe.Event {
    return this.client.webhooks.constructEvent(payload, signature, secret);
  }
}
