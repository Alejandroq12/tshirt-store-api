#!/usr/bin/env node
/**
 * PreToolUse hook: refuses to open the environment files that hold real
 * credentials.
 *
 * `.env`, `.env.test` and `.env.seed` carry live secrets. The `.example`
 * templates carry the same keys with placeholder values and are committed, so
 * they answer every question about configuration without exposing anything.
 *
 * The permission list in settings.json already denies `Read` on these paths.
 * This hook exists because a permission rule matches a tool argument, and a
 * shell command like `cat .env` is not one — it is a string. Both layers are
 * needed; neither is redundant.
 *
 * Blocking convention: exit code 2 stops the tool call and hands stderr back to
 * Claude as the reason. Exit 0 lets the call through.
 */

const PROTECTED = new Set(['.env', '.env.test', '.env.seed']);

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const refuse = (target) => {
  process.stderr.write(
    `Blocked: ${target} holds real credentials and is never read or written by an agent. ` +
      `Read .env.example, .env.test.example or .env.seed.example instead — same keys, placeholder values. ` +
      `If this file genuinely has to change, the repository owner does it by hand.\n`,
  );
  process.exit(2);
};

const basename = (path) => path.split('/').pop() ?? path;

const main = async () => {
  const input = JSON.parse(await readStdin());
  const toolInput = input.tool_input ?? {};

  const path = toolInput.file_path ?? toolInput.notebook_path;
  if (typeof path === 'string' && PROTECTED.has(basename(path))) {
    refuse(basename(path));
  }

  const command = toolInput.command;
  if (typeof command === 'string') {
    for (const match of command.matchAll(/(?<![\w.-])\.env[\w.-]*/g)) {
      if (PROTECTED.has(match[0])) refuse(match[0]);
    }
  }

  process.exit(0);
};

main().catch(() => process.exit(0));
