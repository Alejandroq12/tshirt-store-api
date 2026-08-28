import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../config/env.validation';
import { S3StorageService } from './s3-storage.service';

const BASE_ENVIRONMENT: Partial<EnvironmentVariables> = {
  AWS_REGION: 'us-east-1',
  AWS_S3_BUCKET: 'tshirt-store-images-dev',
};

const serviceWith = (overrides: Partial<EnvironmentVariables> = {}) => {
  const values = { ...BASE_ENVIRONMENT, ...overrides };

  return new S3StorageService({
    get: (key: keyof EnvironmentVariables) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>);
};

describe('S3StorageService', () => {
  let sent: PutObjectCommand[];

  beforeEach(() => {
    sent = [];
    jest.spyOn(S3Client.prototype, 'send').mockImplementation(((
      command: PutObjectCommand,
    ) => {
      sent.push(command);
      return Promise.resolve(undefined);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('upload', () => {
    it('puts the object in the configured bucket with its content type', async () => {
      await serviceWith().upload({
        body: Buffer.from('image-bytes'),
        contentType: 'image/png',
      });

      expect(sent[0]).toBeInstanceOf(PutObjectCommand);
      expect(sent[0].input).toMatchObject({
        Bucket: 'tshirt-store-images-dev',
        ContentType: 'image/png',
      });
    });

    it('sends no ACL, because public read comes from the bucket policy', async () => {
      await serviceWith().upload({
        body: Buffer.from('image-bytes'),
        contentType: 'image/png',
      });

      expect(sent[0].input).not.toHaveProperty('ACL');
    });

    it('returns the key and the URL the schema stores separately', async () => {
      const stored = await serviceWith().upload({
        body: Buffer.from('image-bytes'),
        contentType: 'image/webp',
      });

      expect(stored.key).toMatch(/^[0-9a-f-]{36}\.webp$/);
      expect(stored.url).toBe(
        `https://tshirt-store-images-dev.s3.us-east-1.amazonaws.com/${stored.key}`,
      );
    });

    it('names the object randomly, never after the uploaded file', async () => {
      const service = serviceWith();
      const first = await service.upload({
        body: Buffer.from('a'),
        contentType: 'image/jpeg',
      });
      const second = await service.upload({
        body: Buffer.from('a'),
        contentType: 'image/jpeg',
      });

      expect(first.key).not.toBe(second.key);
    });

    it('groups objects under a prefix when one is given', async () => {
      const stored = await serviceWith().upload({
        body: Buffer.from('a'),
        contentType: 'image/jpeg',
        prefix: 'products/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      });

      expect(stored.key).toMatch(
        /^products\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1\/[0-9a-f-]{36}\.jpg$/,
      );
    });

    it('maps each accepted content type to its own extension', async () => {
      const service = serviceWith();

      const extensions = await Promise.all(
        (['image/jpeg', 'image/png', 'image/webp'] as const).map(
          async (type) => {
            const stored = await service.upload({
              body: Buffer.from('a'),
              contentType: type,
            });
            return stored.key.split('.').pop();
          },
        ),
      );

      expect(extensions).toEqual(['jpg', 'png', 'webp']);
    });
  });

  describe('shutdown', () => {
    it('closes the client, so its sockets do not outlive the process', () => {
      const destroy = jest
        .spyOn(S3Client.prototype, 'destroy')
        .mockImplementation(() => undefined);

      serviceWith().onModuleDestroy();

      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('publicUrl', () => {
    it('uses the CDN base when one is configured', () => {
      const service = serviceWith({
        AWS_S3_PUBLIC_BASE_URL: 'https://cdn.example.com',
      });

      expect(service.publicUrl('a/b.png')).toBe(
        'https://cdn.example.com/a/b.png',
      );
    });

    it('does not double the slash when the base carries one', () => {
      const service = serviceWith({
        AWS_S3_PUBLIC_BASE_URL: 'https://cdn.example.com/',
      });

      expect(service.publicUrl('a/b.png')).toBe(
        'https://cdn.example.com/a/b.png',
      );
    });

    it('falls back to the regional bucket URL', () => {
      expect(serviceWith().publicUrl('a/b.png')).toBe(
        'https://tshirt-store-images-dev.s3.us-east-1.amazonaws.com/a/b.png',
      );
    });
  });
});
