import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

import type { EnvironmentVariables } from '../config/env.validation';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const sendMail = jest.fn();
const close = jest.fn();
const createTransportMock = createTransport as jest.MockedFunction<
  typeof createTransport
>;

const BASE_ENVIRONMENT: Partial<EnvironmentVariables> = {
  SMTP_HOST: 'localhost',
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  MAIL_FROM: 'T-Shirt Store <no-reply@tshirt-store.test>',
};

const serviceWith = (overrides: Partial<EnvironmentVariables> = {}) => {
  const values = { ...BASE_ENVIRONMENT, ...overrides };

  return new MailService({
    get: (key: keyof EnvironmentVariables) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>);
};

describe('MailService', () => {
  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue(undefined);
    close.mockReset();
    createTransportMock.mockReset().mockReturnValue({
      sendMail,
      close,
    } as unknown as ReturnType<typeof createTransport>);
  });

  describe('transport', () => {
    it('is built from the configured host, port and TLS flag', () => {
      serviceWith();

      expect(createTransportMock).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 1025,
          secure: false,
        }),
      );
    });

    it('sends no credentials when none are configured', () => {
      serviceWith();

      expect(createTransportMock.mock.calls[0][0]).not.toHaveProperty('auth');
    });

    it('sends credentials when both are configured', () => {
      serviceWith({ SMTP_USER: 'apikey', SMTP_PASSWORD: 'secret' });

      expect(createTransportMock).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { user: 'apikey', pass: 'secret' } }),
      );
    });

    it('sends no credentials when only one half is configured', () => {
      serviceWith({ SMTP_USER: 'apikey' });

      expect(createTransportMock.mock.calls[0][0]).not.toHaveProperty('auth');
    });
  });

  describe('send', () => {
    it('stamps every message with the configured sender', async () => {
      await serviceWith().send({
        to: 'ana@example.com',
        subject: 'Your password was changed',
        text: 'If this was not you, contact us.',
      });

      expect(sendMail).toHaveBeenCalledWith({
        from: 'T-Shirt Store <no-reply@tshirt-store.test>',
        to: 'ana@example.com',
        subject: 'Your password was changed',
        text: 'If this was not you, contact us.',
      });
    });

    it('passes an HTML body through when one is supplied', async () => {
      await serviceWith().send({
        to: 'ana@example.com',
        subject: 'Back in stock',
        text: 'fallback',
        html: '<p>fallback</p>',
      });

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ html: '<p>fallback</p>' }),
      );
    });

    it('logs a masked recipient, not the address itself', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      await serviceWith().send({
        to: 'ana.rivera@example.com',
        subject: 'Your password was changed',
        text: 'body',
      });

      const [payload] = logged.mock.calls[0] as [{ to: string }];
      expect(payload.to).toBe('a***@example.com');
      expect(JSON.stringify(payload)).not.toContain('ana.rivera');
    });

    it('still delivers to the real address', async () => {
      await serviceWith().send({
        to: 'ana.rivera@example.com',
        subject: 's',
        text: 't',
      });

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ana.rivera@example.com' }),
      );
    });

    it('surfaces a transport failure to the caller', async () => {
      sendMail.mockRejectedValue(new Error('connection refused'));

      await expect(
        serviceWith().send({ to: 'ana@example.com', subject: 's', text: 't' }),
      ).rejects.toThrow('connection refused');
    });
  });

  it('closes the transport on shutdown', () => {
    serviceWith().onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
