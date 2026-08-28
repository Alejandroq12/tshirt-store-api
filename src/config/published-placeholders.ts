export const PUBLISHED_PLACEHOLDERS: readonly string[] = [
  'dev-only-access-secret-replace-in-every-real-deployment',
  'dev-only-refresh-secret-replace-in-every-real-deployment',
  'sk_test_replace_me',
  'whsec_replace_me',
  'manager-dev-password',
  'postgresql://tshirt:tshirt@localhost:5432/tshirt_store?schema=public',
  'postgresql://tshirt:tshirt@localhost:5432/tshirt_store_test?schema=public',
];

export const SECRET_SHAPED_NAME = /(SECRET|PASSWORD|KEY|TOKEN)$/;

export const isSecretShaped = (variable: string): boolean =>
  SECRET_SHAPED_NAME.test(variable);

export const isPublishedPlaceholder = (value: string): boolean =>
  PUBLISHED_PLACEHOLDERS.includes(value.trim());
