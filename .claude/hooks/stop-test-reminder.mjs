#!/usr/bin/env node
/**
 * Stop hook: the challenge requires unit tests written alongside the code, not
 * after it. This checks the one thing that says whether that happened — source
 * files changed, specs did not — and says so before the turn ends.
 *
 * Two safeguards keep it from becoming noise:
 *
 * 1. `stop_hook_active` is set when the model is already continuing because of
 *    a Stop hook. Firing again there is how a hook loops forever, so it exits.
 * 2. It nudges once per session. The marker lives in the system temp directory,
 *    keyed by session id, so nothing is written into the repository.
 *
 * Exit code 2 is what makes the model keep working instead of stopping; stderr
 * is the reason it is given.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { PROJECT_ROOT } from '../../mcp/contract-operations.mjs';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const changedPaths = () => {
  const run = (...args) => {
    try {
      return execFileSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8' });
    } catch {
      return '';
    }
  };

  return [
    ...run('diff', '--name-only', 'HEAD').split('\n'),
    ...run('ls-files', '--others', '--exclude-standard').split('\n'),
  ].filter(Boolean);
};

const main = async () => {
  const input = JSON.parse(await readStdin());

  if (input.stop_hook_active) process.exit(0);

  const marker = join(
    tmpdir(),
    `claude-spec-reminder-${input.session_id ?? 'unknown'}`,
  );
  if (existsSync(marker)) process.exit(0);

  const changed = changedPaths();
  const sources = changed.filter(
    (path) =>
      path.startsWith('src/') &&
      path.endsWith('.ts') &&
      !path.endsWith('.spec.ts'),
  );
  const specs = changed.filter((path) => path.endsWith('.spec.ts'));

  if (sources.length === 0 || specs.length > 0) process.exit(0);

  writeFileSync(marker, '');

  process.stderr.write(
    `${sources.length} source file(s) under src/ changed and no *.spec.ts changed with them: ` +
      `${sources.slice(0, 5).join(', ')}${sources.length > 5 ? ', …' : ''}. ` +
      `The challenge requires unit tests written alongside the code, focused on services. ` +
      `Either add or update the specs for that change, or state plainly why the change needs none ` +
      `(a module wiring file, for instance, is excluded from coverage collection). ` +
      `This reminder fires once per session.\n`,
  );
  process.exit(2);
};

main().catch(() => process.exit(0));
