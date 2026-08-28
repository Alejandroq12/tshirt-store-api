import { SecretTokenService } from './secret-token.service';

describe('SecretTokenService', () => {
  const tokens = new SecretTokenService();

  describe('generate', () => {
    it('produces a URL-safe token that survives an email link', () => {
      expect(tokens.generate()).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('carries 256 bits of entropy', () => {
      expect(tokens.generate()).toHaveLength(43);
    });

    it('never repeats', () => {
      const generated = new Set(
        Array.from({ length: 500 }, () => tokens.generate()),
      );

      expect(generated.size).toBe(500);
    });
  });

  describe('digest', () => {
    it('is deterministic, which is what makes the hash columns work', () => {
      const token = tokens.generate();

      expect(tokens.digest(token)).toBe(tokens.digest(token));
    });

    it('fits the varchar(255) the schema declares', () => {
      expect(tokens.digest(tokens.generate())).toHaveLength(64);
    });

    it('separates tokens that share a long prefix', () => {
      const shared = 'a'.repeat(200);

      expect(tokens.digest(`${shared}1`)).not.toBe(tokens.digest(`${shared}2`));
    });
  });

  describe('matches', () => {
    it('accepts the token that produced the digest', () => {
      const token = tokens.generate();

      expect(tokens.matches(token, tokens.digest(token))).toBe(true);
    });

    it('rejects a different token', () => {
      expect(
        tokens.matches(tokens.generate(), tokens.digest(tokens.generate())),
      ).toBe(false);
    });

    it('rejects a digest of the wrong length without throwing', () => {
      expect(tokens.matches(tokens.generate(), 'too-short')).toBe(false);
    });
  });
});
