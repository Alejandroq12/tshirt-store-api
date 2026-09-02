#!/usr/bin/env node
/**
 * SessionStart hook: states where the work actually stands before the first
 * question is asked.
 *
 * Anything this prints to stdout is added to the session's context. It is kept
 * short on purpose — the point is orientation, not a report. The numbers come
 * from api/openapi.yaml and from the controllers, so they cannot disagree with
 * the repository the way a hand-maintained checklist can.
 *
 * It must never fail loudly: a broken hook here would greet every session with
 * an error, so anything unexpected exits quietly.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadOperations,
  PROJECT_ROOT,
} from '../../mcp/contract-operations.mjs';

/**
 * The status line renders on every turn and cannot afford to parse a 2,800-line
 * contract each time, so the count is computed once here and left in the system
 * temp directory for .claude/statusline.sh to read.
 */
export const PROGRESS_CACHE = join(tmpdir(), 'claude-tshirt-progress');

const git = (...args) => {
  try {
    return execFileSync('git', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
};

const main = () => {
  const operations = loadOperations();
  const pending = operations.filter((operation) => !operation.implemented);
  const done = operations.length - pending.length;

  try {
    writeFileSync(PROGRESS_CACHE, `${done}/${operations.length}`);
  } catch {
    // The status line falls back to showing nothing; not worth failing over.
  }

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || 'unknown';
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;

  const lines = [
    '## Repository state at session start',
    '',
    `- Branch \`${branch}\`, ${dirty === 0 ? 'clean working tree' : `${dirty} uncommitted path(s)`}.`,
    `- Contract operations implemented: **${done} of ${operations.length}**.`,
  ];

  if (pending.length > 0) {
    const byTag = new Map();
    for (const operation of pending) {
      byTag.set(operation.tag, (byTag.get(operation.tag) ?? 0) + 1);
    }

    const breakdown = [...byTag]
      .map(([tag, count]) => `${tag} ${count}`)
      .join(', ');

    lines.push(`- Still to build, by tag: ${breakdown}.`);
    lines.push(
      `- Next in contract order: \`${pending[0].operationId}\` — ${pending[0].method} ${pending[0].path} (${pending[0].authorization}).`,
    );
  } else {
    lines.push('- Every operation in the contract is implemented.');
  }

  lines.push('');
  lines.push(
    'Run `/next-op` for the full detail on the next operation, `/verify` for the CI gate.',
  );

  process.stdout.write(`${lines.join('\n')}\n`);
};

try {
  main();
} catch {
  process.exit(0);
}
