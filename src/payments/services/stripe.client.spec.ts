import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import type { EnvironmentVariables } from '../../config/env.validation';
import { StripeClient } from './stripe.client';

const WEBHOOK_SECRET = 'whsec_test_client';

const ENVIRONMENT: Partial<EnvironmentVariables> = {
  STRIPE_SECRET_KEY: 'sk_test_client',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_API_VERSION: '2026-08-26.dahlia',
};

const clientWith = () =>
  new StripeClient({
    get: (key: keyof EnvironmentVariables) => ENVIRONMENT[key],
  } as unknown as ConfigService<EnvironmentVariables, true>);

const signer = new Stripe('sk_test_signer');

const PAYLOAD = JSON.stringify({
  id: 'evt_1',
  object: 'event',
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_1', object: 'payment_intent' } },
});

const sign = (payload: string, secret = WEBHOOK_SECRET, timestamp?: number) =>
  signer.webhooks.generateTestHeaderString({ payload, secret, timestamp });

describe('StripeClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructEvent', () => {
    it('returns the event whose raw body was signed with the webhook secret', () => {
      const event = clientWith().constructEvent(
        Buffer.from(PAYLOAD),
        sign(PAYLOAD),
        WEBHOOK_SECRET,
      );

      expect(event).toMatchObject({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
      });
    });

    it.each([
      ['a body changed after signing', `${PAYLOAD} `, sign(PAYLOAD)],
      [
        'a signature made with another secret',
        PAYLOAD,
        sign(PAYLOAD, 'whsec_another_secret'),
      ],
      [
        'a signature whose timestamp is one hour old',
        PAYLOAD,
        sign(PAYLOAD, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600),
      ],
      ['a malformed header', PAYLOAD, 'not-a-stripe-signature'],
    ])('refuses %s', (_name, body, signature) => {
      expect(() =>
        clientWith().constructEvent(
          Buffer.from(body),
          signature,
          WEBHOOK_SECRET,
        ),
      ).toThrow(Stripe.errors.StripeSignatureVerificationError);
    });
  });

  describe('createPaymentIntent', () => {
    it('forwards the order idempotency key to Stripe', async () => {
      const intent = { id: 'pi_1', client_secret: 'pi_1_secret' };
      const create = jest
        .spyOn(
          Object.getPrototypeOf(
            signer.paymentIntents,
          ) as Stripe.PaymentIntentsResource,
          'create',
        )
        .mockResolvedValue(intent as Stripe.Response<Stripe.PaymentIntent>);
      const params: Stripe.PaymentIntentCreateParams = {
        amount: 3998,
        currency: 'usd',
        metadata: { orderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      };

      await expect(
        clientWith().createPaymentIntent(params, {
          idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        }),
      ).resolves.toBe(intent);
      expect(create).toHaveBeenCalledWith(params, {
        idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      });
    });
  });

  describe('createPaymentLink', () => {
    it('creates the Payment Link with the given parameters', async () => {
      const link = { id: 'plink_1', url: 'https://buy.stripe.com/test' };
      const create = jest
        .spyOn(
          Object.getPrototypeOf(
            signer.paymentLinks,
          ) as Stripe.PaymentLinksResource,
          'create',
        )
        .mockResolvedValue(link as Stripe.Response<Stripe.PaymentLink>);
      const params: Stripe.PaymentLinkCreateParams = {
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'Classic Crew' },
              unit_amount: 1999,
            },
            quantity: 2,
          },
        ],
        metadata: {
          skuId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          quantity: '2',
        },
      };

      await expect(clientWith().createPaymentLink(params)).resolves.toBe(link);
      expect(create).toHaveBeenCalledWith(params);
    });
  });
});
