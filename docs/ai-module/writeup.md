# AI module write-up

**Repository / PR:** https://github.com/Alejandroq12/tshirt-store-api/pull/19

**Starting commit:** `b5d0387` (`docs/ai-module/first-commit.txt`)

**Improvement:** Three folders under `src/` held 11 to 14 loose files each
across 4 to 6 name stems (`payments`, `notifications`, `auth`), the stem
being the responsibility in this codebase. Each is now split into subfolders
named after what the files do, such as `payments/methods`, `payments/webhook`
and `payments/stripe`, and every grouped folder holds 1 to 3 stems. A rule
script (`check.sh`: a folder fails when it is over 10 files across more than
3 stems) fails on the old tree and passes on the new one. `typecheck`,
`lint`, `build` and the unit suite pass after every move, and the e2e suite
passes at the end. The contract tooling still finds 28 of 28 operations.

## Skills

| Skill (file link) | Goal, inputs → steps → output | Exact invocation |
| --- | --- | --- |
| [`structure-audit`](../../.claude/skills/structure-audit/SKILL.md) | Show which responsibilities are mixed in a marked folder, score what touching it costs, and propose a grouping or record why it stays. In: a root (`src`), the file limit (10) and the stem limit (3). Steps: `scripts/audit.sh` classifies with `check.sh` and lists every folder it does not mark `ok`, `OVER`, `big` and `mixed` alike, with its files grouped by name stem and the lines outside it whose quoted path, resolved against the importing file, lands inside it, then orders the folders safest first. The skill then proposes subfolders by responsibility, or writes down why a folder stays, and lists the outside imports that will change and the docs that draw the layout. Out: `docs/ai-module/evidence/structure-audit-before.txt` (the script output) and `structure-audit-before.md` (proposals and verdicts). Read-only. | `/structure-audit before` |
| [`structure-check`](../../.claude/skills/structure-check/SKILL.md) | Prove the rule holds and the project still works. In: the same root, the file limit (10) and a stem limit (3). Steps: `scripts/run.sh <label>` runs `scripts/check.sh` (exit 1 if any folder is over the file limit across more than the stem limit; big-but-cohesive and small-but-mixed folders are marked and pass), then `npm run typecheck`, `lint`, `build`, `test:ci` whether or not the rule passed, and combines the two exit codes into one verdict. Out: `docs/ai-module/evidence/structure-check-<label>.txt` with the rule output, each gate command's exit code or skipped status, and the verdict; the script's exit status is the verdict. | `/structure-check after` |

**Notes.** Reused, not rebuilt: the project's gate commands from `CLAUDE.md`,
and `mcp/contract-operations.mjs` to prove the controllers are still found
after the move. Setup: `chmod +x` on the three scripts, and Docker for the
final e2e run. The scripts change nothing under `src/`; `run.sh` writes only
its evidence file. Every move is a `git mv`, so history survives
(`git log --follow`) and rollback is `git revert` of one commit per folder.
Between `b5d0387`, where `dev` stands, and this branch, `src/` changes are 26
renames and import paths in 13 files, every changed line an `import` or
`export … from` (`git diff -M b5d0387 HEAD -- src prisma api`): no migration,
no contract change, no runtime change. A diff without rename detection shows
the moved payment files as new, but the payment endpoints, their DTO
validation and the stock-cycle wiring in them exist at `b5d0387`; the moves
changed their paths, not their behaviour.

## Project Results

**Before -> after.** By hand I would have opened each folder, decided which
files belong together, moved them, and fixed broken imports one at a time.
`structure-audit` removed the guessing. It showed five responsibilities in
`payments` and four in `notifications`, listed the 23 outside imports that
would change before I touched anything, and scored each folder by the import
lines crossing its boundary: 6 for `payments`, 22 for `notifications`, 50
for `auth`. The commits had taken that order, safest first. `structure-check`
replaced "I think it still works" with exit codes. The rule was red on the
old tree and green after: `auth` went from 14 files across 6 stems to 8
across 3 plus `credentials/` at 6 across 3, and `payments` from 11 across 5
to four folders of 1 to 3 stems. The gate ran after every commit. My
judgment went into the group names
(`methods` from the contract's "both Stripe payment methods" and
`credentials` from its "Authentication credentials"; `reconciliation` from
the architecture's "reconciliation scan" and `delivery` from the README's
"stock email delivery"), what stays at the root
(the module, and `stock-notification.queue.ts` because both pipelines and a
test import it), the limit itself, and keeping one `credentials/` folder
where the audit proposed `credentials/` plus `tokens/`. Three two-file
services did not justify two subfolders.

**Evidence.**

- `evidence/structure-audit-before.txt`: `audit.sh` at `b5d0387`, run from a
  worktree: the three `OVER` folders and the four `mixed` ones with their
  stems and crossings, and the order.
- `evidence/structure-audit-before.md`: the proposals from a fresh session
  (session A), plus the verdict for each `mixed` folder.
- `evidence/structure-check-before.txt`: `run.sh` at `b5d0387`, from the
  same worktree. Rule exit 1: `OVER 14 files 6 stems src/auth`,
  `OVER 12 files 4 stems src/notifications`,
  `OVER 11 files 5 stems src/payments`. Then the gate, exit 0: the old tree
  compiled and passed before anything moved.
- `evidence/structure-check-after.txt`: rule exit 0, no folder `OVER` and
  every grouped folder at 1 to 3 stems; four small folders are marked
  `mixed` (`authorization` 5, `config` 5, `logging` 4, `storage` 4) and left
  alone. Then typecheck, lint, build and `test:ci` exit 0, plus the e2e tail
  from the run at `1fafe8c`; `src/` and `test/` have not changed since.
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
stem is a proxy for the responsibility, and the skill says so: `config`
holds five stems that are one concern. The four folders marked `mixed` sit
under the file limit; the audit lists them and `structure-audit-before.md`
records why each stays. A stem limit alone could not separate `payments`
and `notifications` from `config` and `authorization`, which is why the
file count stays the trigger. The crossing score resolves every quoted
relative or `src`-rooted path against the file that holds it, so barrel,
double-quoted, side-effect and dynamic imports, `jest.mock` paths and a
parent's `./` import into a nested folder all count. Every crossing into
the seven scored folders is a single-quoted relative `from` into a
top-level folder, so the wider matcher changed none of their scores. For a
nested folder it matters: at `LIMIT=5 STEMS=2`, `src/auth/credentials`
scores 19 where a string match on the root-relative path saw 5. Sessions A
and B ran the skills without any current conversation; the check evidence
was regenerated with the current scripts
after the rule gained the stem count. Neither proved the proposals are the
only sensible grouping.
