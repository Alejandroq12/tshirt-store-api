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
 *
 * This is a guardrail against mistakes, not a sandbox. An adversary who can
 * choose the command string can defeat any text-level check; the model this
 * protects against is a careless call, not a hostile one. The parsing below
 * covers the forms a person or an agent actually types.
 */

const BLOCKED_GIT = new Set([
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
]);

const BLOCKED_GH_PR = new Set(['create', 'merge', 'close', 'edit']);

/**
 * Global options that swallow the next token as their value. Without these,
 * `git -C . commit` reads `.` as the subcommand and the commit slips through.
 */
const GIT_VALUE_FLAGS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
]);

const GH_VALUE_FLAGS = new Set(['-R', '--repo']);

/**
 * The first token that is not an option or an option's value — that is, the
 * subcommand.
 */
const subcommandAfter = (tokens, valueFlags) => {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token.startsWith('-'))
      return { name: token, rest: tokens.slice(index + 1) };
    if (valueFlags.has(token)) index += 1;
  }

  return null;
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const refuse = (message) => {
  process.stderr.write(message);
  process.exit(2);
};

const main = async () => {
  const input = JSON.parse(await readStdin());
  const command = input.tool_input?.command;

  if (typeof command !== 'string') process.exit(0);

  // Quotes are dropped before tokenizing so `git "commit"` and `git 'commit'`
  // read the same as the bare form.
  const segments = command
    .replace(/['"]/g, '')
    .split(/&&|\|\||;|\||\n/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0);

  for (const segment of segments) {
    const tokens = segment[0] === 'sudo' ? segment.slice(1) : segment;
    const [program, ...rest] = tokens;

    if (program === 'git') {
      const subcommand = subcommandAfter(rest, GIT_VALUE_FLAGS);

      if (subcommand && BLOCKED_GIT.has(subcommand.name)) {
        refuse(
          `Blocked: "git ${subcommand.name}" is the repository owner's call, not an agent's. ` +
            `Stage nothing and commit nothing. Instead, propose the work: run /pr to produce a commit ` +
            `breakdown and a pull-request description, and hand that over. Read-only git is allowed.\n`,
        );
      }
    }

    if (program === 'gh') {
      const group = subcommandAfter(rest, GH_VALUE_FLAGS);

      if (group?.name === 'pr') {
        const action = subcommandAfter(group.rest, GH_VALUE_FLAGS);

        if (action && BLOCKED_GH_PR.has(action.name)) {
          refuse(
            `Blocked: "gh pr ${action.name}" publishes outward and the repository owner does that by hand. ` +
              `Run /pr to draft the description instead.\n`,
          );
        }
      }
    }
  }

  process.exit(0);
};

main().catch(() => process.exit(0));
