import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../config/env.validation';
import {
  IMAGE_CONTENT_TYPES,
  type ImageContentType,
} from './image-upload.constants';

export interface StoredObject {
  key: string;
  url: string;
}

export interface UploadRequest {
  body: Buffer;
  contentType: ImageContentType;
  prefix?: string;
}

@Injectable()
export class S3StorageService implements OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicBaseUrl?: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.region = config.get('AWS_REGION', { infer: true });
    this.bucket = config.get('AWS_S3_BUCKET', { infer: true });
    this.publicBaseUrl = config.get('AWS_S3_PUBLIC_BASE_URL', { infer: true });

    this.client = new S3Client({ region: this.region });
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async upload({
    body,
    contentType,
    prefix,
  }: UploadRequest): Promise<StoredObject> {
    const key = this.buildKey(contentType, prefix);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    return { key, url: this.publicUrl(key) };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  publicUrl(key: string): string {
    const base =
      this.publicBaseUrl && this.publicBaseUrl.length > 0
        ? this.publicBaseUrl.replace(/\/+$/, '')
        : `https://${this.bucket}.s3.${this.region}.amazonaws.com`;

    return `${base}/${key}`;
  }

  private buildKey(contentType: ImageContentType, prefix?: string): string {
    const name = `${randomUUID()}.${IMAGE_CONTENT_TYPES[contentType]}`;
    const cleaned = prefix?.replace(/^\/+|\/+$/g, '');

    return cleaned ? `${cleaned}/${name}` : name;
  }
}
