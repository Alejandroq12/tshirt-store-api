---
name: structure-check
description: Executable check that no folder under src is both over a file limit and mixed across more than a few name stems, that the tree the audit proposed exists or has its deviations recorded, plus the project gate (typecheck, lint, build, unit tests) so a reorganisation is proven not to break anything. All three always run, their exit codes combine into one verdict, and every command is reported with its exit code or as skipped. Use after moving files, before opening a pull request that touches the layout, or to show a reviewer that a structure rule holds.
---

# Checking folder structure

Run `.claude/skills/structure-check/scripts/run.sh <label>`, the label being
letters, digits, `-` and `_`. It does three things, always all three, and
combines their exit codes into one verdict. Each runs whether or not the one
before it passed: a tree still over the limit is a half-finished
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

2. **The proposal.** `scripts/proposal.sh` reads the audit report,
   `docs/ai-module/evidence/structure-audit-before.md` unless `AUDIT=` names
   another, and takes every path in its `proposal` block. The report and the
   block are required: a missing report, a block that is missing, repeated or
   unterminated, or a malformed line exits 2, and only a block that is
   present once and empty means nothing was proposed. A path that exists is kept. A path that does not must have a
   line in the report's `deviations` block, `proposed -> actual: reason`,
   whose actual path exists; the check prints it as recorded. A path found
   elsewhere without such a line is unrecorded and a path found nowhere is
   missing; either fails. One `credentials/` where the audit proposed
   `credentials/` and `tokens/` is a recorded deviation, not a green run by
   accident.
3. **The gate.** `npm run typecheck`, `npm run lint`, `npm run build`,
   `npm run test:ci`, in that order. A failing command ends the gate and the
   commands after it are reported as skipped, never as passed.
4. **The verdict.** PASS only when the rule, the proposal and the gate all
   exit 0. The script's own exit status is the verdict.

The script writes `docs/ai-module/evidence/structure-check-<label>.txt`: the
rule's output and exit code, the proposal's lines and exit code, one line per
gate command with its exit code and summary (`Tests: …` for jest) or its
skipped status, then the verdict. Report
one table from it, command, exit code or skipped, one-line result, and end
with the verdict line.

## Rules

- A rule exit of 1 is a valid result, reported, not repaired: name the
  folders marked `OVER`, show the gate beside them, and stop. The two answer
  different questions, and the regrouping is `structure-audit`'s proposal
  and a commit of its own, which this check then proves.
- A deviation from the proposal is a decision: record it in the report's
  `deviations` block, one line, `proposed -> actual: reason`. Both sides are
  repository-relative paths under the same top-level folder, either an exact
  file or a folder ending in `/`, which maps every file under it, as
  `src/auth/tokens/ -> src/auth/credentials/: …`; the reason is not empty. A
  line that breaks that shape exits 2. The check prints a valid record as
  recorded; an unrecorded deviation fails the run.
- The rule finds a smell; the grouping stays a judgment call. The stem is a
  proxy for the responsibility: two stems can be one responsibility, as in
  `config`, and one stem can hide two. A `mixed` folder is not a failure:
  `structure-audit` lists every folder this check does not mark `ok` and
  records a verdict for each, and the file limit is what turns a growing junk
  drawer into `OVER`.
- The e2e suite runs once at the end, by the caller, in a plain terminal:
  `npm run test:e2e` needs Docker and takes minutes. Say so, and append its
  tail to the evidence file.
