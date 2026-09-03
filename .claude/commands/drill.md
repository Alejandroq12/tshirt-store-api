---
description: Spaced retrieval practice on Claude platform concepts, using this repository as the example
allowed-tools: Read, Grep, Glob, Write(.claude/learning-record.md), Edit(.claude/learning-record.md)
argument-hint: '[area: memory | permissions | commands | agents | skills | hooks | mcp | context | all]'
---

Run a retrieval drill on **$ARGUMENTS** (pick the weakest area from the record if
empty).

## Honest caveat, state it once at the start of a first session and not again

This drill is built from the capability areas of Claude Code and the Claude
developer platform as this repository actually uses them. It is not derived from
an official certification blueprint, and nobody here has seen one. It will make
the concepts stick; it cannot promise exam coverage. If an official syllabus
turns up, this command should be rewritten against it.

## The areas, and the example to draw every question from

Every question must point at a real file in this repository. Abstract questions
about Claude Code teach nothing that a document could not; questions about a
mechanism the user has running in front of them do.

| Area          | The example here                                                                        |
| ------------- | --------------------------------------------------------------------------------------- |
| `memory`      | `CLAUDE.md` — what belongs in project memory, and what does not                         |
| `permissions` | `.claude/settings.json` — allow, ask, deny, and which wins                              |
| `commands`    | `.claude/commands/*.md` — frontmatter, `$ARGUMENTS`, `allowed-tools`                    |
| `agents`      | `.claude/agents/*.md` — why a subagent gets its own context, and tool restriction       |
| `skills`      | `.claude/skills/nest-operation/` — progressive disclosure, when a skill beats a command |
| `hooks`       | `.claude/hooks/*.mjs` — the events, stdin payload, exit code 2, `stop_hook_active`      |
| `mcp`         | `mcp/contract-server.mjs` — stdio transport, tools versus resources, `.mcp.json`        |
| `context`     | Why `/next-op` calls an MCP tool instead of reading a 2,800-line contract               |

## How to run it

**One question at a time.** Ask, stop, wait. Never batch questions and never
answer your own.

**Retrieval before explanation.** Ask them to recall or predict first: "the
`Stop` hook exits 2 — what does the model do next, and what stops that from
looping?" Only explain after they have answered.

**Prediction questions are the best ones.** Give a small change and ask what
happens: "`settings.local.json` allows `Bash(git commit:*)` and
`settings.json` denies it — which wins, and why is that the right precedence?"

**Grade honestly and briefly.** Right, partly right, or wrong, then the correct
answer in two or three sentences with the file to look at. Then the next
question.

Five or six questions per session. Mix in one from an area they got right in an
earlier session — spacing is the point.

## The record

Keep `.claude/learning-record.md` (git-ignored, personal). Read it before
starting and update it at the end. Keep it small:

```markdown
# Learning record

_Updated: YYYY-MM-DD_

## Solid

- area — what they explained correctly and when

## Shaky

- area — the specific misconception, in their own words if possible

## Not covered yet

- area
```

Do not pad the record. A misconception written precisely is worth more than a
page of topics touched. If the same misconception appears twice, say so out loud
and suggest a proper lesson on it rather than another drill.
