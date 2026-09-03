---
description: Show the next contract operation to implement, with everything the contract says about it
allowed-tools: mcp__tshirt-contract__next_unimplemented_operation, mcp__tshirt-contract__get_operation, mcp__tshirt-contract__contract_progress, Read, Grep, Glob
argument-hint: '[tag]'
---

Report the next operation to build.

Call `next_unimplemented_operation` from the `tshirt-contract` MCP server. If
`$ARGUMENTS` names a tag (Likes, Cart, Checkout, Orders, Payments, Webhooks),
pass it as the `tag` argument. Also call `contract_progress` for the overall
count.

Do not read `api/openapi.yaml` in full to answer this. The MCP server reads it
for you and returns a few hundred tokens instead of a few thousand; that is the
reason it exists.

## Report

- **Where the work stands.** Implemented out of total, and the breakdown by tag.
- **The operation.** `operationId`, method and path, the summary, the
  `x-requirement` it serves, and `x-authorization` — quoted, not paraphrased.
- **Every declared status code**, with what produces each one. Missing status
  codes are the most common gap between contract and implementation, so list
  them all, including the ones that look obvious.
- **The request schema**, by name.
- **What has to be true beyond the status codes.** Read
  `docs/data-lifecycle.md` for the state and relationship rules that touch this
  operation, and `docs/implementation-notes.md` for any numbered rule that
  names it. Quote them.
- **What it depends on.** Which unimplemented operations must exist first, if
  any. Say why, in one clause.

End with one line: the file that would be touched first, and nothing more. Do
not start writing code — this command reports, it does not implement. Use
`/op <operationId>` for the implementation plan.
