# The agentic workflow

How this repository is worked on with Claude Code, and what each piece of that
setup is for. Everything described here is committed under `.claude/`, `.mcp.json`
and `mcp/`, so it can be read rather than taken on trust.

The reason it is written down: an AI-assisted repository where the assistance is
invisible is harder to review, not easier. This says what the tooling does, what
it refuses to do, and where the boundaries are.

## The shape of it

```text
CLAUDE.md              the working agreement, loaded into every session
.claude/
  settings.json        permissions and hook registration, shared
  settings.local.json  personal overrides, git-ignored
  commands/            seven slash commands
  agents/              four read-only review subagents
  skills/              two procedural skills
  hooks/               four scripts on lifecycle events
  statusline.sh        branch, tree state, contract progress
.mcp.json              the project's MCP server
mcp/contract-server.mjs  a server that exposes api/openapi.yaml as tools
.github/workflows/
  claude-review.yml    the same agents, run on every pull request
  claude.yml           @claude on demand in issues and comments
```

## The contract is the source of truth, mechanically

`api/openapi.yaml` declares 28 operations. `mcp/contract-server.mjs` reads it and
answers four questions over MCP: list the operations, describe one, name the next
unimplemented one, and report progress. Implementation is detected by controller
method name — `CLAUDE.md` makes "the controller method is named exactly after the
`operationId`" a rule, and that rule is what makes the correlation possible.

This replaced a hand-maintained checklist. A checklist drifts from the code the
first time someone forgets to tick a box; this cannot, because it reads the code
and the contract every time it is asked.

It also costs less. Answering "what is next and what does the contract say about
it" used to mean loading 2,800 lines of YAML into the conversation. It is now a
few hundred tokens, and the answer comes from the contract rather than from a
summary of it.

A read-only PostgreSQL MCP server is useful alongside it, so a question about
data is answered by querying the database rather than by guessing from the
schema. It is deliberately **not** in `.mcp.json`: a connection string is
per-machine, and committing one means committing a port and a database name that
are true for exactly one developer. Each person adds it at local scope instead:

```bash
claude mcp add postgres --scope local -- \
  npx -y @modelcontextprotocol/server-postgres@0.6.2 \
  postgresql://tshirt:tshirt@localhost:5432/tshirt_store
```

with whatever `POSTGRES_PORT` their own `.env` uses. `.mcp.json` holds what is
true for the repository; anything true only for one machine belongs at local
scope.

## What the tooling refuses to do

Three refusals are enforced by code, not by convention. A rule written only in a
document is a request; these are hooks, and they run before the tool call.

**Commits belong to the repository owner.** `.claude/hooks/block-git-write.mjs`
blocks `git commit`, `push`, `tag`, `reset`, `rebase`, `merge`, `revert`,
`cherry-pick`, `clean` and `gh pr create`, including when they are hidden behind
`&&` in a compound command. Read-only git is untouched. The `/pr` command
produces a commit breakdown and a pull-request description to hand over instead.

**The real environment files are never opened.**
`.claude/hooks/block-env-read.mjs` blocks reads and writes of `.env`, `.env.test`
and `.env.seed`, both as a file path and as a shell command. The committed
`.example` templates carry the same keys with placeholder values and answer every
question about configuration. The permission list in `settings.json` denies the
same paths; both layers are needed, because a permission rule matches a tool
argument and `cat .env` is a string, not an argument.

**Unrequested scope is a finding.** The `scope-warden` subagent and the
`/anchor` command exist for one reason: this project is evaluated against fixed
requirements, and work no requirement asks for costs time the requirements
needed. Both apply the same test — quote a sentence from `api/openapi.yaml` or
one of the four design documents, or the verdict is "document the scenario, do
not build it".

## The rest of it

**Commands** are the repeatable procedures. `/verify` runs the seven CI steps in
CI order and stops at the first failure. `/next-op` and `/op` turn the contract
into a plan. `/anchor` is the scope gate. `/pr` drafts commits. `/defend` runs a
cold-call interview on how the code works, which is preparation for a technical
review rather than a coding aid.

**Subagents** are read-only reviewers, each with one job and its own context:
`contract-auditor` compares implementation to contract, `scope-warden` finds
unanchored work, `test-gap-finder` names untested branches, `security-reviewer`
checks the secret-hygiene and access-control invariants the codebase already
holds. Separate contexts matter — an auditor that has been party to writing the
code is a worse auditor.

**Skills** carry procedure. `nest-operation` holds the file order, DTO
conventions, status-code mapping, CASL registrar pattern and test expectations
for adding one operation; detail sits in `reference/` files that load only when
that step is reached. `prisma-migration` holds the database procedure, including
the two things that must not be broken.

**Hooks** cover the lifecycle. Beyond the two refusals above, `SessionStart`
prints where the work stands — branch, tree state, operations implemented out of
28, what is next — so a session begins oriented, and `Stop` gives one reminder
per session when source files changed and no spec changed with them.

## The same review, in CI

Two workflows put the setup above on pull requests.

`.github/workflows/claude-review.yml` runs when a pull request is opened,
reopened or marked ready. Its prompt does not restate any review criteria — it
points Claude at `CLAUDE.md`, `.claude/agents/contract-auditor.md` and
`.claude/agents/scope-warden.md` and tells it to apply them to the diff. That is
the reason the agents are committed rather than personal: editing one file
changes the local review and the CI review together, and they cannot drift
apart. It comments and never blocks a merge.

`.github/workflows/claude.yml` is the on-demand half: mention `@claude` in an
issue, a comment or a review and it answers there, with the same `CLAUDE.md`,
skills and agents loaded from the checkout. By default the action only responds
to users with write access.

Four things in those files are deliberate and easy to get wrong:

- **Both actions are pinned by commit SHA**, not by tag. A tag can be moved; a
  SHA cannot. The version is a comment beside it.
- **The review skips pull requests from forks.** This repository is public, and
  a fork never receives the secret, so without the guard the job would fail
  rather than skip. Drafts are skipped for the same reason a draft is a draft.
- **`labeled` is filtered to one label.** `pull_request: types: [labeled]` fires
  for every label; only `claude-review` re-runs the review. That doubles as the
  way to ask for a second pass without reopening the pull request.
- **A workflow change skips its own review.** The action refuses to run unless
  the workflow file already exists, byte for byte, on the default branch. Any
  pull request that edits `claude-review.yml` or `claude.yml` is therefore
  reviewed by nothing, and the change has to reach the default branch before the
  next pull request gets a real review. This is a defence, not a defect: without
  it a pull request could rewrite the workflow to leak the token and then run the
  rewritten version on itself.

  It skips **green**. The step reports success in a second or two and the check
  goes through, so a review that finishes suspiciously fast reviewed nothing —
  read the step log rather than the check mark.

## Considered and not implemented

One piece was designed and deliberately left out, for the reason anything else
gets left out here: it was not required, and the time belonged to the operations.

- **Automatic formatting on every edit.** A `PostToolUse` hook running
  `prettier --write` and `eslint --fix` on each touched file would stop
  `format:check` ever failing in CI. It also adds about a second to every file
  write, and the pre-commit hook already catches the same problem before the code
  reaches a branch. Deferred as a convenience, not a gap.
