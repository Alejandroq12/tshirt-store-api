---
description: Run the full CI gate locally, in CI order, stopping at the first failure
allowed-tools: Bash(npm run lint), Bash(npm run format:check), Bash(npm run typecheck), Bash(npm run lint:api), Bash(npm run build), Bash(npm run test:ci), Bash(npm run test:e2e), Bash(npm run format), Bash(npm run lint:fix), Bash(docker compose ps), Bash(docker compose up -d), Read, Grep, Glob
argument-hint: '[fix]'
---

Run the same seven checks `.github/workflows/ci.yml` runs, in the same order, and
stop at the first one that fails. Running them in CI order matters: a type error
found by step 3 is cheaper to read than the same error surfacing as forty failing
tests in step 6.

1. `npm run lint`
2. `npm run format:check`
3. `npm run typecheck`
4. `npm run lint:api`
5. `npm run build`
6. `npm run test:ci`
7. `npm run test:e2e`

Step 7 needs PostgreSQL. Check `docker compose ps` first; if the postgres service
is not up, run `docker compose up -d` and say so. It also needs `.env.test` to
exist — if the run fails because it does not, say so and stop. Do not create or
modify `.env.test`; that file is the repository owner's.

## Arguments

`$ARGUMENTS` is `fix` or empty.

- Empty: report failures, change nothing.
- `fix`: when step 1 or step 2 fails, run `npm run lint:fix` and `npm run format`
  and re-run that step. Never auto-fix steps 3 through 7 — a failing type, a
  broken contract or a red test is a decision, not a formatting slip.

## Reporting

When everything passes, say so in one line with the unit-test count and coverage
percentages, and nothing else.

When something fails:

- Name the step and quote the actual error, trimmed to the part that matters.
- Say what is wrong, in one or two sentences.
- Propose the fix. Do not apply it unless the fix is a formatting or lint
  autofix, or the user asks.
- Do not run the later steps. A red step 3 makes steps 4 to 7 noise.

Never report a step as passing without having run it.
