import { createSecretScrubber } from './secret-scrubber';

describe('createSecretScrubber', () => {
  it('censors a secret quoted inside an error message', () => {
    const scrub = createSecretScrubber([
      'postgresql://tshirt:hunter2@db:5432/store',
    ]);

    expect(
      scrub(
        'Error: connect ECONNREFUSED postgresql://tshirt:hunter2@db:5432/store',
      ),
    ).toBe('Error: connect ECONNREFUSED [redacted]');
  });

  it('also censors the password on its own, not just the whole URL', () => {
    const scrub = createSecretScrubber([
      'postgresql://tshirt:hunter2@db:5432/store',
    ]);

    expect(scrub('authentication failed for password hunter2')).toBe(
      'authentication failed for password [redacted]',
    );
  });

  it('decodes a percent-encoded password before matching', () => {
    const scrub = createSecretScrubber([
      'postgresql://u:p%40ss%2Fword@db/store',
    ]);

    expect(scrub('bad password p@ss/word')).toBe('bad password [redacted]');
  });

  it('censors every occurrence, not only the first', () => {
    const scrub = createSecretScrubber(['supersecretvalue']);

    expect(scrub('supersecretvalue and supersecretvalue')).toBe(
      '[redacted] and [redacted]',
    );
  });

  it('prefers the longest match, so a prefix does not mask it', () => {
    const scrub = createSecretScrubber(['secretvalue', 'secretvalue-extended']);

    expect(scrub('secretvalue-extended')).toBe('[redacted]');
  });

  it('ignores values too short to be a secret', () => {
    const scrub = createSecretScrubber(['USD', '1025', 'a']);

    expect(scrub('USD 1025 a')).toBe('USD 1025 a');
  });

  it('censors a value from eight characters, the shortest it treats as secret', () => {
    const scrub = createSecretScrubber(['abcdefg', 'zyxwvuts']);

    expect(scrub('abcdefg zyxwvuts')).toBe('abcdefg [redacted]');
  });

  it('censors a URL password on its own only from four characters', () => {
    const short = createSecretScrubber(['redis://default:abc@cache:6379']);
    const long = createSecretScrubber(['redis://default:abcd@cache:6379']);

    expect(short('abc')).toBe('abc');
    expect(long('abcd')).toBe('[redacted]');
  });

  it('censors a URL without a password as a whole and nothing else', () => {
    const scrub = createSecretScrubber(['redis://cache.internal:6379']);

    expect(scrub('lost redis://cache.internal:6379 at cache.internal')).toBe(
      'lost [redacted] at cache.internal',
    );
  });

  it('ignores undefined entries, so optional configuration is safe to pass', () => {
    const scrub = createSecretScrubber([undefined, 'supersecretvalue']);

    expect(scrub('supersecretvalue')).toBe('[redacted]');
  });

  it('returns the text untouched when nothing is configured', () => {
    expect(createSecretScrubber([])('anything at all')).toBe('anything at all');
  });
});
