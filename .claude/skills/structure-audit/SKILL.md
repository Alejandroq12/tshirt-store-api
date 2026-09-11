---
name: structure-audit
description: Find folders that hold too many loose files and show which responsibilities are mixed inside each one, then propose subfolders that group related files by responsibility. Use when a reviewer says files are dispersed, before reorganising a module, or to decide what a new folder should be called.
---

# Auditing folder structure

A folder with many loose files hides which files belong together. This skill
makes that visible and proposes the grouping. It changes nothing.

## Steps

1. Run `.claude/skills/structure-audit/scripts/audit.sh` (default root `src`,
   default limit 10; `LIMIT=8 … audit.sh test` to change either). It prints
   every folder over the limit with its files grouped by name stem — the part
   before the first dot — because in this codebase the stem is the
   responsibility: `stripe-webhook.controller.ts` and
   `stripe-webhook.service.ts` belong together.
2. For each folder printed, propose subfolders. Rules:
   - the `*.module.ts` stays at the folder root, so `app.module.ts` is untouched;
   - a file two groups share stays at the root;
   - a spec moves with its subject;
   - name each group after what its files do, with a word the challenge or the
     docs already use.
3. List the imports outside the folder that will change:
   `grep -rn "from '.*/<folder>/" src test --include='*.ts'`.
4. List the docs that draw the layout: `grep -n "<folder>/" CLAUDE.md README.md`.
5. Write `docs/ai-module/evidence/structure-audit-<label>.md` with: the table
   of folders over the limit, the proposed tree per folder, the import lines
   from step 3, the doc lines from step 4. Nothing else.

## Rules

- Read-only. Do not move or edit anything under `src/` or `test/`.
- Never propose a folder whose name is not a responsibility (`misc`, `utils`,
  `other` are refused).
- Quote real file names; do not summarise a folder as "various services".
