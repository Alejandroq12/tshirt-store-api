import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(__dirname, '..');

const SENTINEL = 'sentinel-secret-value';

interface Started {
  code: number;
  output: string;
}

const start = async (environment: Record<string, string>): Promise<Started> => {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['-r', 'ts-node/register', 'src/main.ts'],
      {
        cwd: ROOT,
        env: { ...process.env, ...environment },
        timeout: 60_000,
      },
    );
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
};

describe('a failure during start-up (e2e)', () => {
  describe.each([
    [
      'invalid configuration, which fails inside NestFactory.create',
      {
        JWT_ACCESS_SECRET: 'short',
        DATABASE_URL: `postgresql://tshirt:${SENTINEL}@127.0.0.1:59999/nope`,
      },
    ],
    [
      'an unreachable database, which fails after it',
      { DATABASE_URL: `postgresql://tshirt:${SENTINEL}@127.0.0.1:59999/nope` },
    ],
  ])('%s', (_label, environment) => {
    let started: Started;

    beforeAll(async () => {
      started = await start(environment);
    }, 70_000);

    it('exits non-zero', () => {
      expect(started.code).not.toBe(0);
    });

    it('reports the failure as one structured line', () => {
      const [first] = started.output
        .split('\n')
        .filter((line) => line.trim() !== '');

      expect(JSON.parse(first)).toMatchObject({
        level: 'fatal',
        msg: 'application failed to start',
      });
    });

    it('never prints the secret it was configured with', () => {
      expect(started.output).not.toContain(SENTINEL);
    });

    it('says what went wrong', () => {
      const [first] = started.output
        .split('\n')
        .filter((line) => line.trim() !== '');
      const { detail } = JSON.parse(first) as { detail: string };

      expect(detail.length).toBeGreaterThan(0);
    });
  });
});
