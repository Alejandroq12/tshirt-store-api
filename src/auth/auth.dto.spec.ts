import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validateSync, ValidatorOptions } from 'class-validator';

import { SignUpRequest } from './auth.dto';

function failingProperties(
  type: ClassConstructor<object>,
  value: object,
  options?: ValidatorOptions,
): string[] {
  return validateSync(plainToInstance(type, value), options).map(
    (error) => error.property,
  );
}

// A 64-character local part and labels of at most 63 characters keep the
// address valid in shape, so only its total length is at stake.
function emailOfLength(length: number): string {
  const head = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.`;

  return `${head}${'d'.repeat(length - head.length - '.com'.length)}.com`;
}

const SIGN_UP = {
  email: 'ana@example.com',
  password: 'x'.repeat(8),
  firstName: 'Ana',
  lastName: 'Rivera',
};

describe('SignUpRequest', () => {
  it.each([8, 128])('accepts a password of %i characters', (length) => {
    expect(
      failingProperties(SignUpRequest, {
        ...SIGN_UP,
        password: 'x'.repeat(length),
      }),
    ).toEqual([]);
  });

  it.each([7, 129])('rejects a password of %i characters', (length) => {
    expect(
      failingProperties(SignUpRequest, {
        ...SIGN_UP,
        password: 'x'.repeat(length),
      }),
    ).toEqual(['password']);
  });

  it.each(['firstName', 'lastName'])(
    'accepts a %s of 1 and of 100 characters',
    (property) => {
      for (const length of [1, 100]) {
        expect(
          failingProperties(SignUpRequest, {
            ...SIGN_UP,
            [property]: 'x'.repeat(length),
          }),
        ).toEqual([]);
      }
    },
  );

  it.each(['firstName', 'lastName'])(
    'rejects an empty %s and one of 101 characters',
    (property) => {
      for (const value of ['', 'x'.repeat(101)]) {
        expect(
          failingProperties(SignUpRequest, { ...SIGN_UP, [property]: value }),
        ).toEqual([property]);
      }
    },
  );

  it('rejects a malformed email', () => {
    expect(
      failingProperties(SignUpRequest, { ...SIGN_UP, email: 'not-an-email' }),
    ).toEqual(['email']);
  });

  // @IsEmail() already rejects an address over 254 characters, so a
  // 255-character one is not a useful acceptance case.
  it('accepts a 254-character email and rejects a 256-character one', () => {
    const longest = emailOfLength(254);
    const tooLong = emailOfLength(256);

    expect(longest).toHaveLength(254);
    expect(tooLong).toHaveLength(256);
    expect(
      failingProperties(SignUpRequest, { ...SIGN_UP, email: longest }),
    ).toEqual([]);
    expect(
      failingProperties(SignUpRequest, { ...SIGN_UP, email: tooLong }),
    ).toEqual(['email']);
  });

  it('reports every required property of an empty body', () => {
    expect(failingProperties(SignUpRequest, {}).sort()).toEqual([
      'email',
      'firstName',
      'lastName',
      'password',
    ]);
  });

  it('rejects a role under the global pipe options', () => {
    expect(
      failingProperties(
        SignUpRequest,
        { ...SIGN_UP, role: 'manager' },
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).toEqual(['role']);
  });
});
