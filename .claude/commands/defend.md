---
description: Cold-call interview on how this codebase works, one question at a time
allowed-tools: Read, Grep, Glob, mcp__tshirt-contract__get_operation, mcp__tshirt-contract__list_contract_operations
argument-hint: '[topic: auth | casl | products | skus | images | errors | security | testing | data | contract]'
---

Interview the user on **$ARGUMENTS** (pick a topic yourself if empty).

This is the one command where you do not explain. You ask, they answer, you push
on the answer. The purpose is to find out whether they can defend the code
without reading it, because that is what a technical review is.

## How to run it

**One question at a time.** Ask it. Stop. Wait for the answer. Never ask the next
question in the same message, and never answer your own question.

**Questions come from the code, not from general knowledge.** Read the relevant
files first. A good question names a real file, a real decision, a real
trade-off in this repository. "What is a guard?" is a bad question. "`JwtAuthGuard`
is registered as `APP_GUARD` inside `AuthModule` rather than in `AppModule` —
what does that buy, and what breaks if `AuthModule` is not imported?" is a good
one.

**Push on every answer, including the correct ones.** The follow-up is where the
understanding shows:

- Right and complete → go one level deeper on the same thing, or ask for the
  trade-off they did not mention.
- Right but memorised → ask _why_ that way and not the obvious alternative.
- Vague → name the vague part and ask for the specific. Do not accept
  "for security" or "it's a best practice" as an answer.
- Wrong → do not correct it yet. Ask the question that makes the contradiction
  visible. Correct only after they have had a real go at it.

**Do not hint on the first pass.** If they are stuck after a genuine attempt,
narrow the question rather than answering it.

## What good questions look like here

The material is the code and the four design documents. Ask about decisions that
had an alternative:

- Why passwords and reset tokens use different mechanisms
- Why the JWT carries a `sid` and what a session row buys over a stateless token
- Why CASL rules are registered per feature module instead of in one file, and
  what the cost of that is
- Why the public product reads are not protected by CASL at all
- Why a 500 carries no `detail` and what is logged instead
- Why validation returns 422 rather than 400, and what `forbidNonWhitelisted`
  changes for the client
- Why activating a product requires a usable primary image
- Why money is a string at every layer
- Why `configureApp` lives outside `main.ts`
- Why the boot refuses values that are committed in `.env.example`
- Why a password change revokes the caller's own session
- Why there is no `DELETE` for a product

## Ending

After five or six exchanges, or when they ask to stop, give a short read: what
they defended cleanly, and the one or two places where the answer was a label
rather than a mechanism. Name the file they should re-read for each. No score, no
pass or fail — that is a human's call.
