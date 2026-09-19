# AI module write-up

**Repository / PR:** https://github.com/Alejandroq12/tshirt-store-api/pull/19

**Starting commit:** `b5d0387` (`docs/ai-module/first-commit.txt`)

**Improvement:** Three folders under `src/` held 11 to 14 loose files each
(`payments`, `notifications`, `auth`) and mixed several responsibilities.
Each is now split into subfolders named after what the files do, such as
`payments/methods`, `payments/webhook` and `payments/stripe`. A rule script
(`check.sh`, limit 10 files per folder) fails on the old tree and passes on
the new one. `typecheck`, `lint`, `build` and the unit suite pass after every
move, and the e2e suite passes at the end. The contract tooling still finds
28 of 28 operations.

## Skills

| Skill (file link) | Goal, inputs → steps → output | Exact invocation |
| --- | --- | --- |
| [`structure-audit`](../../.claude/skills/structure-audit/SKILL.md) | Show which responsibilities are mixed in a crowded folder and propose a grouping. In: a root (`src`) and a limit (10). Steps: `scripts/audit.sh` lists every folder over the limit with its files grouped by name. The skill then proposes subfolders by responsibility, lists the outside imports that will change and the docs that draw the layout. Out: `docs/ai-module/evidence/structure-audit-before.md`. Read-only. | `/structure-audit before` |
| [`structure-check`](../../.claude/skills/structure-check/SKILL.md) | Prove the rule holds and the project still works. In: the same root and limit. Steps: `scripts/run.sh <label>` runs `scripts/check.sh` (exit 1 if any folder is over the limit), then `npm run typecheck`, `lint`, `build`, `test:ci` whether or not the rule passed, and combines the two exit codes into one verdict. Out: `docs/ai-module/evidence/structure-check-<label>.txt` with the rule output, each gate command's exit code or skipped status, and the verdict; the script's exit status is the verdict. | `/structure-check after` |

**Notes.** Reused, not rebuilt: the project's gate commands from `CLAUDE.md`,
and `mcp/contract-operations.mjs` to prove the controllers are still found
after the move. Setup: `chmod +x` on the three scripts, and Docker for the
final e2e run. The scripts change nothing under `src/`; `run.sh` writes only
its evidence file. Every move is a `git mv`, so history survives
(`git log --follow`) and rollback is `git revert` of one commit per folder.
No migration, no contract change, no runtime change.

## Project Results

**Before -> after.** By hand I would have opened each folder, decided which
files belong together, moved them, and fixed broken imports one at a time.
`structure-audit` removed the guessing. It showed five responsibilities in
`payments` and four in `notifications`, and listed the 23 outside imports
before I touched anything. `structure-check` replaced "I think it still
works" with exit codes. The rule was red on the old tree and green after,
and the gate ran after every commit. My judgment went into the group names
(`methods` from the challenge's "both payment methods"; `delivery`,
`reconciliation` and `credentials` from the docs), what stays at the root
(the module, and `stock-notification.queue.ts` because both pipelines and a
test import it), the limit itself, and keeping one `credentials/` folder
where the audit proposed `credentials/` plus `tokens/`. Three two-file
services did not justify two subfolders.

**Evidence.**

- `evidence/structure-check-before.txt`: rule exit 1. `OVER 14 src/auth`,
  `OVER 12 src/notifications`, `OVER 11 src/payments`. Captured with the
  first version of the skill, which stopped after the rule; `run.sh` now runs
  the gate regardless of the rule's result.
- `evidence/structure-audit-before.md`: the report and proposal from a fresh
  session (session A).
- `evidence/structure-check-after.txt`: rule exit 0, then typecheck, lint,
  build and `test:ci` exit 0 (session B), plus the e2e tail.
- `evidence/baseline-unit.txt`, `evidence/baseline-e2e.txt`: the suites one
  commit before the starting commit, all green. `b5d0387` itself added
  three unit tests and three e2e tests, which is the whole difference
  between the baseline counts (503 and 93) and the after counts (506 and
  96).
- Commits: one per folder, each green on its own.
- Mocks versus real: unit tests mock Prisma and Stripe. E2e uses a real
  PostgreSQL and a real Redis, with Stripe, SMTP and S3 stubbed.

**Limitations.** `test/` holds 14 loose e2e specs and was not grouped. The
rule targets `src/`, and grouping specs changes every relative import. The
rule counts files, not responsibilities, so a folder can be under 10 and
still mixed. The fresh sessions proved the skills run without any current
conversation. They did not prove the proposals are the only sensible
grouping.
