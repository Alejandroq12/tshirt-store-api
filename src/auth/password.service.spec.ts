import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import type { EnvironmentVariables } from '../config/env.validation';
import { PasswordService } from './password.service';

const TEST_COST: Partial<EnvironmentVariables> = {
  PASSWORD_HASH_MEMORY_KIB: 8192,
  PASSWORD_HASH_TIME_COST: 2,
  PASSWORD_HASH_PARALLELISM: 1,
};

describe('PasswordService', () => {
  let passwords: PasswordService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PasswordService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: keyof EnvironmentVariables) => TEST_COST[key],
          },
        },
      ],
    }).compile();

    passwords = moduleRef.get(PasswordService);
  });

  it('accepts the password it hashed', async () => {
    const digest = await passwords.hash('example-password');

    await expect(passwords.verify('example-password', digest)).resolves.toBe(
      true,
    );
  });

  it('rejects a different password', async () => {
    const digest = await passwords.hash('example-password');

    await expect(passwords.verify('other-password', digest)).resolves.toBe(
      false,
    );
  });

  it('salts, so the same password never yields the same digest', async () => {
    const [first, second] = await Promise.all([
      passwords.hash('example-password'),
      passwords.hash('example-password'),
    ]);

    expect(first).not.toBe(second);
  });

  it('uses argon2id with the configured cost', async () => {
    expect(await passwords.hash('example-password')).toMatch(
      /^\$argon2id\$v=19\$m=8192,p=1,t=2\$/,
    );
  });

  it('distinguishes passwords that differ only past the 72nd byte', async () => {
    const prefix = 'a'.repeat(72);
    const digest = await passwords.hash(`${prefix}ONE`);

    await expect(passwords.verify(`${prefix}TWO`, digest)).resolves.toBe(false);
    await expect(passwords.verify(`${prefix}ONE`, digest)).resolves.toBe(true);
  });

  it('accepts a password at the contract’s maximum length', async () => {
    const longest = 'p'.repeat(128);
    const digest = await passwords.hash(longest);

    await expect(passwords.verify(longest, digest)).resolves.toBe(true);
  });

  it('produces a digest that fits the varchar(255) the schema declares', async () => {
    expect(
      (await passwords.hash('example-password')).length,
    ).toBeLessThanOrEqual(255);
  });

  it('returns false for a stored value that is not a digest', async () => {
    await expect(
      passwords.verify('example-password', 'not-a-hash'),
    ).resolves.toBe(false);
    await expect(passwords.verify('example-password', '')).resolves.toBe(false);
  });
});
