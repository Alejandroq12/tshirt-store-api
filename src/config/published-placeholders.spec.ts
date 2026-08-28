import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isPublishedPlaceholder,
  isSecretShaped,
  PUBLISHED_PLACEHOLDERS,
} from './published-placeholders';

const ROOT = resolve(__dirname, '..', '..');

const templates = (): string[] =>
  readdirSync(ROOT).filter((name) => /^\.env(\..+)?\.example$/.test(name));

const APPLICATION_SECTION_ENDS = '-- Docker Compose only --';

const variables = (template: string): [string, string][] =>
  readFileSync(resolve(ROOT, template), 'utf8')
    .split(APPLICATION_SECTION_ENDS)[0]
    .split('\n')
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [match[1], match[2].trim()]);

describe('published placeholders', () => {
  const found = templates().flatMap((template) =>
    variables(template)
      .filter(([name, value]) => isSecretShaped(name) && value !== '')
      .map(([name, value]) => [template, name, value] as const),
  );

  it('finds the templates to check', () => {
    expect(templates().length).toBeGreaterThanOrEqual(3);
    expect(found.length).toBeGreaterThanOrEqual(4);
  });

  it.each(found)('%s: %s is caught by the guard', (_template, _name, value) => {
    expect(isPublishedPlaceholder(value)).toBe(true);
  });

  describe('what counts as secret-shaped', () => {
    it.each([
      'JWT_ACCESS_SECRET',
      'STRIPE_SECRET_KEY',
      'SEED_MANAGER_PASSWORD',
      'SMTP_PASSWORD',
      'AWS_SECRET_ACCESS_KEY',
    ])('%s is', (name) => {
      expect(isSecretShaped(name)).toBe(true);
    });

    it.each([
      'PASSWORD_RESET_TOKEN_TTL',
      'PASSWORD_HASH_TIME_COST',
      'PASSWORD_RESET_RATE_LIMIT',
      'DATABASE_URL',
      'STORE_CURRENCY',
    ])('%s is not', (name) => {
      expect(isSecretShaped(name)).toBe(false);
    });
  });

  it('does not reject a real secret', () => {
    expect(isPublishedPlaceholder('sk_live_51AbCdEfGh')).toBe(false);
    expect(isPublishedPlaceholder('x'.repeat(48))).toBe(false);
    expect(isPublishedPlaceholder('a-real-manager-password')).toBe(false);
  });

  it('ignores surrounding whitespace', () => {
    expect(isPublishedPlaceholder('  manager-dev-password  ')).toBe(true);
  });

  it('lists no value twice', () => {
    expect(new Set(PUBLISHED_PLACEHOLDERS).size).toBe(
      PUBLISHED_PLACEHOLDERS.length,
    );
  });
});
