---
name: structure-check
description: Executable check that no folder under src holds more than a fixed number of loose files, followed by the project gate (typecheck, lint, build, unit tests) so a reorganisation is proven not to break anything. Reports every command with its exit code. Use after moving files, before opening a pull request that touches the layout, or to show a reviewer that a structure rule holds.
---

# Checking folder structure

Two things, in this order, and the second only if the first passes.

1. **The rule.** `.claude/skills/structure-check/scripts/check.sh` lists every
   folder under `src/` with its direct file count and exits 1 if any exceeds
   the limit. The limit is printed in the output; it is never lowered to make
   a run pass.
2. **The gate.** `npm run typecheck`, `npm run lint`, `npm run build`,
   `npm run test:ci`, stopping at the first failure. Moving a file cannot hide
   a broken import from `tsc`.

Write `docs/ai-module/evidence/structure-check-<label>.txt` holding the rule's
output and, per gate command, its exit code and the summary line (`Tests: …`
for jest). Then report one table: command, exit code, one-line result.

## Rules

- Never edit a file to make the check pass; report the failure.
- A rule exit of 1 is a valid result — report which folders are over and stop.
- Do not run the e2e suite from this skill; it needs Docker and takes minutes.
  Say so, and let the caller run `npm run test:e2e` once at the end.
