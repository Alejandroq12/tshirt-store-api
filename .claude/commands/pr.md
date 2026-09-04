---
description: Draft a commit breakdown and a pull-request description from the working tree
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git branch:*), Read, Grep, Glob, mcp__tshirt-contract__contract_progress, mcp__tshirt-contract__list_contract_operations
argument-hint: '[base branch, default dev]'
---

Draft the commits and the pull-request description for the current work.

**You do not commit.** A `PreToolUse` hook blocks `git commit`, `git push`,
`git tag` and `gh pr create`, and that is deliberate — the repository owner
authors every commit. Produce text they can act on.

## Read the actual change first

- `git status --porcelain --untracked-files=all`
- `git diff HEAD` and `git diff --stat HEAD`
- `git log --oneline -12` to match the existing message style
- `git log --oneline ${ARGUMENTS:-dev}..HEAD` for commits already on the branch

**`git diff HEAD` does not show untracked files.** A new file is exactly the
kind of change worth reading closely, and it is invisible to the diff that
describes the rest of the work. Plain `--porcelain` also collapses a wholly new directory into one `??` entry,
which is why the listing above passes `--untracked-files=all`. Take every path
it marks `??`, read each one in full, and treat it as part of the change. A summary that silently
omits a whole new file is worse than no summary.

Feature branches here are cut from `dev` and merged back into it; `main` is the
deployed branch. Diffing against `main` by mistake pulls in every commit `dev` is
ahead by, which reads as though this branch changed all of it.

Read the diff. Do not describe files by their names — describe what changed
inside them.

## Audit the diff before describing it

Reading the diff to summarise it and reading it to find what should not ship are
two different passes, and only the second one catches anything. Do this one
first, and report what it finds even when the answer is nothing.

Go through the diff looking for:

- **Anything accidental.** A file touched for no reason, a formatting-only
  change mixed into a behavioural one, a dependency added and not used, a
  generated file that should be ignored.
- **Debug residue.** `console.log`, a `.only` or `.skip` on a test, a commented-out
  block, a temporary script, a hardcoded value that was meant to be read from
  configuration.
- **Unfinished markers.** A `TODO`, `FIXME` or "pending" note introduced by this
  change. Either it is finished or it is a known limitation someone wrote down.
- **Documentation the change made false.** A count, an instruction, a path, or a
  decision recorded as open that this change closes. Nothing catches these
  automatically, which is why they belong in this pass.
- **A new error path with no test**, and a new branch in a service that no spec
  reaches. Name the case, not the coverage percentage.
- **Something the requirements do not ask for.** Run the reasoning in `/anchor`
  on it, or say plainly that it is unanchored.
- **Secrets or credentials**, in any form, including in a fixture or an example.

Report this as a short list before the commit breakdown. If the diff is clean,
say so in one line — but only after actually reading it, and say what you read
(the file count and the line count) so the claim is checkable.

## The commit breakdown

Group the change into commits that each stand alone: a reviewer should be able
to read one and understand it without the next. Typical seams here are the
contract, the migration, the service, the controller and DTOs, the tests, and
the documentation.

For each commit give:

- The message, in the style the log already uses (`type(scope): subject` in the
  imperative, lowercase subject, no trailing period).
- The exact paths it contains.
- One line on why those paths belong together.

If the working tree is really one change, say so and propose one commit. Do not
split for the sake of splitting.

Flag anything that should not be committed at all: a stray debug line, a
commented-out block, a file that belongs in `.gitignore`.

## The pull-request description

**Hard budget: 10 lines of prose, headings excluded. Shorter is better.** A long
description is not thorough, it is unreviewed — the author has handed over their
notes instead of deciding what matters. Cutting is the work.

```markdown
## What

One sentence. What now works that did not before.

## Requirement

The quoted sentence that this serves, from api/openapi.yaml (x-requirement),
docs/architecture.md, docs/data-lifecycle.md or docs/implementation-notes.md.
One line. If the change is unanchored, say so plainly instead of inventing a
justification.

## How

At most two bullets. A decision earns a line only if a competent reviewer would
get it wrong without being told — not because it was hard to write. Merge
related decisions into one bullet rather than listing them.

## Status codes

New operations only, and one line: the codes and what produces each, separated by
`·`. Omit the section entirely for anything else.

## Testing

One or two lines: the case count, the gate result, and anything verified outside
the suite. Never claim a check that did not run — write "not run in this session".

## Not in this change

At most two lines. What was deliberately left out, and why.
```

Cut in this order when over budget: how it works (the diff shows that), anything
the reader can infer, anything true of every pull request in this repository,
adjectives. Keep the decisions a reviewer would otherwise question, and the
sentence that anchors the work.

Never pad a section to fill it. If a section has nothing to say, delete it.
