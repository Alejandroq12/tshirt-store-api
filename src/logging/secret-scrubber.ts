import { REDACTED } from './redaction';

export type SecretScrubber = (text: string) => string;

const MINIMUM_CONFIGURED_LENGTH = 8;

const MINIMUM_PASSWORD_LENGTH = 4;

const passwordWithin = (value: string): string | undefined => {
  try {
    const password = new URL(value).password;
    return password.length > 0 ? decodeURIComponent(password) : undefined;
  } catch {
    return undefined;
  }
};

export const createSecretScrubber = (
  secrets: readonly (string | undefined)[],
): SecretScrubber => {
  const values = secrets.filter(
    (secret): secret is string =>
      typeof secret === 'string' && secret.length >= MINIMUM_CONFIGURED_LENGTH,
  );

  const expanded = new Set(values);
  for (const value of values) {
    const password = passwordWithin(value);
    if (password && password.length >= MINIMUM_PASSWORD_LENGTH)
      expanded.add(password);
  }

  const ordered = [...expanded].sort((a, b) => b.length - a.length);
  if (ordered.length === 0) return (text) => text;

  return (text) =>
    ordered.reduce(
      (scrubbed, secret) => scrubbed.split(secret).join(REDACTED),
      text,
    );
};
