import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

@Injectable()
export class SecretTokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  matches(token: string, digest: string): boolean {
    const candidate = Buffer.from(this.digest(token), 'utf8');
    const expected = Buffer.from(digest, 'utf8');

    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  }
}
