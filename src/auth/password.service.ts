import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

import type { EnvironmentVariables } from '../config/env.validation';

@Injectable()
export class PasswordService {
  private readonly options: argon2.HashOptions;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.options = {
      type: argon2.argon2id,
      memoryCost: config.get('PASSWORD_HASH_MEMORY_KIB', { infer: true }),
      timeCost: config.get('PASSWORD_HASH_TIME_COST', { infer: true }),
      parallelism: config.get('PASSWORD_HASH_PARALLELISM', { infer: true }),
    };
  }

  hash(plainText: string): Promise<string> {
    return argon2.hash(plainText, this.options);
  }

  async verify(plainText: string, digest: string): Promise<boolean> {
    try {
      return await argon2.verify(digest, plainText);
    } catch {
      return false;
    }
  }
}
