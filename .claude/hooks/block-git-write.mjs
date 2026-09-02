#!/usr/bin/env node
/**
 * PreToolUse hook: the repository owner authors every commit.
 *
 * CLAUDE.md states the rule, but a rule in a document is a request. This is the
 * enforcement: any git subcommand that rewrites history, publishes it, or moves
 * a branch is refused before it runs. Read-only git is untouched, so `status`,
 * `diff`, `log` and `show` all work normally.
 *
 * Compound commands are handled: `npm test && git commit -m x` is split on the
 * shell operators and each segment is checked, so hiding a commit behind
 * another command does not get past it.
 */

const BLOCKED_GIT = [
  'commit',
  'push',
  'tag',
  'reset',
  'rebase',
  'clean',
  'revert',
  'cherry-pick',
  'merge',
  'am',
  'apply',
];

const GIT_PATTERN = new RegExp(
  `^(?:sudo\\s+)?git\\s+(?:-\\S+\\s+)*(${BLOCKED_GIT.join('|')})\\b`,
);

const GH_PATTERN = /^(?:sudo\s+)?gh\s+pr\s+(create|merge|close|edit)\b/;

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const main = async () => {
  const input = JSON.parse(await readStdin());
  const command = input.tool_input?.command;

  if (typeof command !== 'string') process.exit(0);

  const segments = command
    .split(/&&|\|\||;|\||\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const git = GIT_PATTERN.exec(segment);
    if (git) {
      process.stderr.write(
        `Blocked: "git ${git[1]}" is the repository owner's call, not an agent's. ` +
          `Stage nothing and commit nothing. Instead, propose the work: run /pr to produce a commit ` +
          `breakdown and a pull-request description, and hand that over. Read-only git is allowed.\n`,
      );
      process.exit(2);
    }

    const gh = GH_PATTERN.exec(segment);
    if (gh) {
      process.stderr.write(
        `Blocked: "gh pr ${gh[1]}" publishes outward and the repository owner does that by hand. ` +
          `Run /pr to draft the description instead.\n`,
      );
      process.exit(2);
    }
  }

  process.exit(0);
};

main().catch(() => process.exit(0));
