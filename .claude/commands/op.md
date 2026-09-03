---
description: Produce the implementation plan for one contract operation, without writing code
allowed-tools: mcp__tshirt-contract__get_operation, mcp__tshirt-contract__list_contract_operations, Read, Grep, Glob
argument-hint: <operationId>
---

Plan the implementation of the operation **$ARGUMENTS**.

Call `get_operation` on the `tshirt-contract` MCP server first. If the
operationId is not recognised, say so and list the near matches — do not guess
at what was meant.

Then load the `nest-operation` skill and follow the file order it defines. Read
the closest already-implemented operation in the same shape (a manager write, a
public read, a client-owned resource) and match it rather than inventing a
second way of doing the same thing.

## What to produce

A plan, in this order, with a file path for every item:

1. **Prisma.** Whether the models and constraints already exist. Name the tables,
   the unique constraints and the checks that this operation depends on, and say
   whether a migration is needed. If one is, that is a separate decision — flag
   it, do not fold it into the plan silently.
2. **DTOs.** Request and response classes, the validation decorators for each
   field, and which existing shared types apply. Money is a decimal string, never
   a number. Unknown properties are rejected, so every accepted field must be
   declared.
3. **Service.** The method signature, the queries, the transaction boundary if
   there is one, and every branch that produces a non-2xx. Map each branch to the
   status code the contract declares.
4. **Controller.** The route, the HTTP status decorator, the auth decorator
   (`@Public()`, `@OptionalAuth()`, or nothing for the default guard), and
   `@CheckAbilities()` when the contract's `x-authorization` names a role. The
   method name must equal the operationId exactly.
5. **CASL.** Whether a new rule is needed, and if so the exact `can(...)` call
   and which feature module's registrar it goes in. Rules never go in
   `src/authorization/`.
6. **Unit tests.** One line per case, named. Cover every non-2xx branch from
   step 3, not only the happy path. Services are the focus.
7. **End-to-end tests.** Only when the operation is part of authentication,
   checkout or order history — those are the three the requirements name.

## Rules for the plan itself

- Quote the contract for every status code you assign. If you are assigning one
  the contract does not declare, stop and say so.
- Where the contract and an existing implementation disagree, say which one you
  are following and why. Do not quietly pick one.
- If the plan needs something no requirement asks for, run the reasoning in
  `/anchor` on it before including it.
- Do not write any code. The output is the plan. Ask before starting.
