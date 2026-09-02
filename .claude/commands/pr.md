---
description: Draft a commit breakdown and a pull-request description from the working tree
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git branch:*), Read, Grep, Glob, mcp__tshirt-contract__contract_progress, mcp__tshirt-contract__list_contract_operations
argument-hint: '[base branch, default main]'
---

Draft the commits and the pull-request description for the current work.

**You do not commit.** A `PreToolUse` hook blocks `git commit`, `git push`,
`git tag` and `gh pr create`, and that is deliberate — the repository owner
authors every commit. Produce text they can act on.

## Read the actual change first

- `git status --porcelain`
- `git diff HEAD` and `git diff --stat HEAD`
- `git log --oneline -12` to match the existing message style
- `git log --oneline ${ARGUMENTS:-main}..HEAD` for commits already on the branch

Read the diff. Do not describe files by their names — describe what changed
inside them.

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

```
## What

One paragraph. What now works that did not before.

## Requirement

The quoted sentence from api/openapi.yaml (x-requirement), docs/architecture.md,
docs/data-lifecycle.md or docs/implementation-notes.md that this serves. If the
change is unanchored, say that plainly instead of inventing a justification.

## How

The three or four decisions a reviewer needs. Not a file list.

## Status codes

For a new operation: every code the contract declares, and what produces it.
Omit this section for anything else.

## Testing

Which specs were added or changed, and what they assert. Then the result of the
CI gate — actually run through /verify, or say explicitly that it was not run.

## Not in this change

Anything deliberately left out, and why. Scenarios noticed and not built belong
here.
```

Never claim a check passed that you did not run. If `/verify` has not been run
in this session, write "not run in this session" rather than assuming.
