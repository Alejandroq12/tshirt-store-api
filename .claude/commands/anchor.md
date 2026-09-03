---
description: Decide whether a proposed change has a requirement anchor, or must be documented instead
allowed-tools: Read, Grep, Glob, mcp__tshirt-contract__get_operation, mcp__tshirt-contract__list_contract_operations
argument-hint: <the thing someone wants to build>
---

Decide whether this belongs in the codebase:

**$ARGUMENTS**

This repository is evaluated against a fixed set of requirements. Work no
requirement asks for is not an improvement here — it is scope the reviewer did
not ask for, and it has already been raised twice as a problem. Your job is to
be the gate, not the enthusiast.

## The only sources that count as an anchor

| Source                         | What it anchors                                                        |
| ------------------------------ | ---------------------------------------------------------------------- |
| `api/openapi.yaml`             | Operations, status codes, payloads, `x-requirement`, `x-authorization` |
| `docs/architecture.md`         | Required controls, payment and webhook flows                           |
| `docs/data-lifecycle.md`       | State machines and relationship rules                                  |
| `docs/implementation-notes.md` | The numbered application-level rules                                   |
| `docs/db.dbml`                 | The data model                                                         |

Nothing else. Specifically **not** anchors: "good practice", "OWASP recommends",
"a senior reviewer would flag it", "it makes X work properly", "it was cheap",
"it was already half-built", "a code review asked for it". A review finding
something real does not turn it into a requirement.

## Answer in this shape

**1. The quote.** Find and quote the exact sentence that requires this, naming
the file and line. Search before concluding — use the contract MCP tools for
anything operation-shaped. If you cannot find a sentence, say `No anchor` and
skip to step 4.

**2. What the quote actually requires.** Restate it literally. Watch for the
common failure: the quote requires _a_, the proposal builds _a plus b_. Say so
if that is what is happening, and treat _b_ as unanchored.

**3. Is this the objective or around it?** The delivery is the operations in
`api/openapi.yaml`. Infrastructure that makes those operations work is in. A
mechanism that makes the infrastructure nicer is around it.

**4. The verdict.** One of exactly three:

- **BUILD** — quoted anchor, and the proposal does not exceed it.
- **DOCUMENT** — no anchor, but the scenario is real. Then write the paragraph
  that belongs in the README under _Decisions worth knowing_ or _Known
  limitations_: what the case is, why the literal requirement handles it badly,
  and that it was deliberately not implemented. Offer to add it.
- **DROP** — no anchor and no real scenario.

Give the verdict even when the user clearly wants BUILD. If you find yourself
constructing an argument for why something unanchored is really required, that
is the answer: it is not.
