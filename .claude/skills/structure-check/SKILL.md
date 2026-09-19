---
name: structure-check
description: Executable check that no folder under src holds more than a fixed number of loose files, plus the project gate (typecheck, lint, build, unit tests) so a reorganisation is proven not to break anything. Both always run, their exit codes combine into one verdict, and every command is reported with its exit code or as skipped. Use after moving files, before opening a pull request that touches the layout, or to show a reviewer that a structure rule holds.
---

# Checking folder structure

Run `.claude/skills/structure-check/scripts/run.sh <label>`. It does two things,
always both, and combines their exit codes into one verdict. The gate runs
whether or not the rule passed: a tree still over the limit is a half-finished
reorganisation, which is where a broken import is most likely, and `tsc` is
what finds it.

1. **The rule.** `scripts/check.sh` lists every folder under `src/` with its
   direct file count and exits 1 if any exceeds the limit. The limit is printed
   in the output; it is never lowered to make a run pass.
   `LIMIT=8 ROOT=test … run.sh` changes either.
2. **The gate.** `npm run typecheck`, `npm run lint`, `npm run build`,
   `npm run test:ci`, in that order. A failing command ends the gate and the
   commands after it are reported as skipped, never as passed.
3. **The verdict.** PASS only when the rule and the gate both exit 0. The
   script's own exit status is the verdict.

The script writes `docs/ai-module/evidence/structure-check-<label>.txt`: the
rule's output and exit code, one line per gate command with its exit code and
summary (`Tests: …` for jest) or its skipped status, then the verdict. Report
one table from it, command, exit code or skipped, one-line result, and end
with the verdict line.

## Rules

- Never edit a file to make the check pass; report the failure.
- A rule exit of 1 is a valid result. Report which folders are over, and the
  gate beside it: the two answer different questions.
- Do not run the e2e suite from this skill; it needs Docker and takes minutes.
  Say so, and let the caller run `npm run test:e2e` once at the end and append
  its tail to the evidence file.
