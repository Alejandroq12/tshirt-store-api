import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import type { AuthenticatedUser } from '../auth/authenticated-user';
import { IS_PUBLIC } from '../auth/decorators/public.decorator';
import { REQUIRED_ABILITIES } from '../authorization/decorators/check-abilities.decorator';
import { AbilitiesGuard } from '../authorization/guards/abilities.guard';
import { PaymentIntentsController } from './payment-intents.controller';
import { PaymentLinksController } from './payment-links.controller';
import type { PaymentsService } from './payments.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import type { StripeWebhookService } from './stripe-webhook.service';

const methodTarget = (controller: object, method: string): object => {
  const target = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(controller) as object,
    method,
  )?.value as object | undefined;

  if (!target) throw new Error(`Missing controller method: ${method}`);
  return target;
};

describe('payment controllers', () => {
  const payments = {
    createLink: jest.fn(),
    createIntent: jest.fn(),
  };
  const webhooks = { receive: jest.fn() };
  const links = new PaymentLinksController(
    payments as unknown as PaymentsService,
  );
  const intents = new PaymentIntentsController(
    payments as unknown as PaymentsService,
  );
  const webhook = new StripeWebhookController(
    webhooks as unknown as StripeWebhookService,
  );
  const user: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'CLIENT',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates Payment Link and Payment Intent creation', async () => {
    const linkInput = {
      skuId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      quantity: 2,
    };
    const intentInput = {
      orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };

    await links.createPaymentLink(linkInput, user);
    await intents.createPaymentIntent(intentInput, user);

    expect(payments.createLink).toHaveBeenCalledWith(linkInput, user);
    expect(payments.createIntent).toHaveBeenCalledWith(intentInput, user);
  });

  it('routes both creation operations at the contract paths', () => {
    const linkTarget = methodTarget(links, 'createPaymentLink');
    const intentTarget = methodTarget(intents, 'createPaymentIntent');

    expect(Reflect.getMetadata(PATH_METADATA, PaymentLinksController)).toBe(
      'payment-links',
    );
    expect(Reflect.getMetadata(PATH_METADATA, linkTarget)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, linkTarget)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(PATH_METADATA, PaymentIntentsController)).toBe(
      'payment-intents',
    );
    expect(Reflect.getMetadata(PATH_METADATA, intentTarget)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, intentTarget)).toBe(
      RequestMethod.POST,
    );
  });

  it('requires the PaymentLink ability only on manager link creation', () => {
    const linkTarget = methodTarget(links, 'createPaymentLink');
    const intentTarget = methodTarget(intents, 'createPaymentIntent');

    expect(Reflect.getMetadata(REQUIRED_ABILITIES, linkTarget)).toEqual([
      { action: 'create', subject: 'PaymentLink' },
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, linkTarget)).toContain(
      AbilitiesGuard,
    );
    expect(
      Reflect.getMetadata(REQUIRED_ABILITIES, intentTarget),
    ).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, intentTarget)).toBeUndefined();
  });

  it('passes the raw body and signature to the public webhook', async () => {
    const rawBody = Buffer.from('{"id":"evt_1"}');
    const request = { rawBody };

    await webhook.receiveStripeWebhook(request as never, 'signature');

    expect(webhooks.receive).toHaveBeenCalledWith(rawBody, 'signature');
  });

  it('exposes the webhook at its public 204 route', () => {
    const target = methodTarget(webhook, 'receiveStripeWebhook');

    expect(Reflect.getMetadata(PATH_METADATA, StripeWebhookController)).toBe(
      'webhooks/stripe',
    );
    expect(Reflect.getMetadata(PATH_METADATA, target)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, target)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, target)).toBe(204);
    expect(Reflect.getMetadata(IS_PUBLIC, target)).toBe(true);
    expect(Reflect.getMetadata(REQUIRED_ABILITIES, target)).toBeUndefined();
  });
});
