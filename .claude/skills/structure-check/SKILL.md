---
name: structure-check
description: Executable check that no folder under src is both over a file limit and mixed across more than a few name stems, plus the project gate (typecheck, lint, build, unit tests) so a reorganisation is proven not to break anything. Both always run, their exit codes combine into one verdict, and every command is reported with its exit code or as skipped. Use after moving files, before opening a pull request that touches the layout, or to show a reviewer that a structure rule holds.
---

# Checking folder structure

Run `.claude/skills/structure-check/scripts/run.sh <label>`, the label being
letters, digits, `-` and `_`. It does two things,
always both, and combines their exit codes into one verdict. The gate runs
whether or not the rule passed: a tree still over the limit is a half-finished
reorganisation, which is where a broken import is most likely, and `tsc` is
what finds it.

1. **The rule.** `scripts/check.sh` lists every folder under `src/` with two
   numbers: its direct file count and its stem count. The stem is the file
   name up to the first dot, and in this codebase the stem is the
   responsibility: `stripe-webhook.controller.ts` and
   `stripe-webhook.service.ts` are one. The file count is the trigger, the
   stem count is the proof.
   - `OVER`: over the file limit across more than the stem limit. Big and
     mixed; the run fails.
   - `big`: over the file limit with few stems. Fourteen files across two
     stems is cohesive; passes.
   - `mixed`: under the file limit with many stems. Passes, but reported,
     because it is a smell.

   Defaults are 10 files and 3 stems, printed in the output. Three is where
   this codebase's grouped folders landed: the feature's own stem, its barrel
   and one shared file. `LIMIT=8 STEMS=2 ROOT=test … run.sh` changes any of
   them for another root or a stricter rule; a run that fails at the defaults
   is reported at the defaults.

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

- A rule exit of 1 is a valid result, reported, not repaired: name the
  folders marked `OVER`, show the gate beside them, and stop. The two answer
  different questions, and the regrouping is `structure-audit`'s proposal
  and a commit of its own, which this check then proves.
- The rule finds a smell; the grouping stays a judgment call. The stem is a
  proxy for the responsibility: two stems can be one responsibility, as in
  `config`, and one stem can hide two. A `mixed` folder is not a failure:
  `structure-audit` lists every folder this check does not mark `ok` and
  records a verdict for each, and the file limit is what turns a growing junk
  drawer into `OVER`.
- The e2e suite runs once at the end, by the caller, in a plain terminal:
  `npm run test:e2e` needs Docker and takes minutes. Say so, and append its
  tail to the evidence file.
