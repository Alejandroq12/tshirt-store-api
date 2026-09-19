---
name: structure-audit
description: List every folder the structure check does not mark ok, show which responsibilities are mixed inside each one, score the lines that cross its boundary, and propose subfolders that group related files by responsibility, safest folder first, or record why a folder stays as it is. Use when a reviewer says files are dispersed, before reorganising a module, or to decide what a new folder should be called.
---

# Auditing folder structure

A folder with many loose files hides which files belong together. This skill
makes that visible, scores what touching each folder costs, and either
proposes the grouping or records why the folder stays. It changes nothing;
`structure-check` verifies the proposal afterwards, path by path.

## Steps

1. Run `.claude/skills/structure-audit/scripts/audit.sh` (default root `src`,
   limit 10 files and 3 stems; `LIMIT=8 STEMS=2 … audit.sh test` changes any
   of them). It classifies folders with `structure-check`'s own script and
   lists every folder that script does not mark `ok`: `OVER`, `big` and
   `mixed` alike, so a folder the check reports cannot fall out of the audit.
   For each it prints the files grouped by name stem and the number of lines
   outside the folder whose quoted path, resolved against the file that holds
   it, lands in the folder or names it: `from`, side-effect and dynamic
   imports, re-exports and `jest.mock` paths alike, and a parent's `./sub/x`
   for a nested folder.
   The stem is the part before the first dot, because in this codebase the
   stem is the responsibility: `stripe-webhook.controller.ts` and
   `stripe-webhook.service.ts` belong together. It ends with the folders
   ordered safest first, fewest crossings first: every crossing is a path a
   regrouping can change, and each folder has to leave the gate green before
   the next one moves. Read the same list from the bottom for the folders the
   rest of the code depends on most, where a wrong grouping costs the most.
2. For each folder printed, propose subfolders, or say why it stays as it is.
   A `mixed` folder under the file limit may be one concern under several
   stems, as `config`; either way the verdict is written down. Rules for a
   proposal:
   - the `*.module.ts` stays at the folder root, so `app.module.ts` is untouched;
   - a file two groups share stays at the root;
   - a spec moves with its subject;
   - name each group after what its files do, with a word `CLAUDE.md`,
     `README.md`, `api/openapi.yaml` or `docs/architecture.md` already uses:
     `methods` and `webhook` from the contract's "Webhook handling for both
     Stripe payment methods", `reconciliation` from the architecture's
     "scheduled reconciliation scan".
3. List the lines behind the score with `SHOW=1 … audit.sh`, which prints
   them under each folder, and keep those that name a file that moves.
4. List the docs that draw the layout: `grep -n "<folder>/" CLAUDE.md README.md`.
5. Save the script output as `docs/ai-module/evidence/structure-audit-<label>.txt`
   and write `docs/ai-module/evidence/structure-audit-<label>.md` with: the
   table of folders printed, with mark, files, stems and crossings; the
   proposed tree per folder, or the verdict that it stays and why; a
   `proposal` fenced block with every proposed path, one per line, which
   `structure-check` verifies afterwards; an empty `deviations` fenced block,
   filled during the moves with `proposed -> actual: reason` for each decision
   that departs from the proposal; the lines from step 3; the doc lines from
   step 4. Nothing else.

## Rules

- The audit writes its two evidence files and nothing else; the moves come
  afterwards, one folder per commit, and `structure-check` proves each one.
- The script finds a smell; the grouping stays a judgment call. The stem is a
  proxy for the responsibility: say why when the two disagree, as
  `secret-token.service.ts` in `credentials/` rather than `tokens/`.
- The crossing count resolves every quoted relative or `src`-rooted path
  against the file that holds it; a path built at runtime or through an alias
  is not counted.
- A folder name states a responsibility: `payments/webhook` and
  `auth/credentials` are accepted, `payments/misc` is not.
- Name files as they are: `stripe-webhook.service.ts`, not "various
  services".
