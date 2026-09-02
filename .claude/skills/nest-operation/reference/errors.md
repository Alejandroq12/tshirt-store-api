# Mapping a branch to a status code

Every error leaves this API as `application/problem+json`, RFC 7807.
`ProblemExceptionFilter` in `src/common/filters/problem-exception.filter.ts`
catches everything — a `@Catch()` with no argument — so a service throws a
NestJS exception and the shape is handled.

Work the other way round from the usual instinct: take the status codes
`get_operation` reports, and give each one a branch. A declared code with no
branch is a contract break, and a branch with an undeclared code is the same
break in the other direction.

## What throws what

| Code | Throw                                     | The case                                                           |
| ---- | ----------------------------------------- | ------------------------------------------------------------------ |
| 400  | `BadRequestException`                     | Well-formed but wrong: an expired or already-used token            |
| 401  | Nothing — the guard does it               | Missing, malformed or expired access token, or an inactive session |
| 403  | Nothing — `AbilitiesGuard` does it        | The role is not allowed the action                                 |
| 404  | `NotFoundException`                       | Does not exist, **or exists and is not visible to this caller**    |
| 409  | `ConflictException`                       | Unique constraint, or a state transition the current state forbids |
| 413  | `PayloadTooLargeException`                | Upload over 5 MB                                                   |
| 415  | `UnsupportedMediaTypeException`           | Content type outside jpeg, png, webp                               |
| 422  | The pipe, or `ValidationProblemException` | Shape is wrong                                                     |

## 404 versus 403, and why it is deliberate

Another client's cart item is **404**, not 403. The contract says so in as many
words: _"Cart item does not exist in the current client's cart."_ A 403 would
confirm the item exists, which is a disclosure. A resource the caller cannot see
is a resource that does not exist, as far as that caller is concerned.

403 is for the role being wrong on an operation the caller can otherwise see —
a client calling a manager route. That distinction is worth a test on both
sides.

Product visibility works the same way: `@OptionalAuth()` on the reads, and a
manager sees every state while anonymous and client callers see active only. A
product that exists but is retired is a 404 to a client.

## Prisma errors

The filter maps two codes and only two:

```ts
const PRISMA_STATUS = { P2002: CONFLICT, P2025: NOT_FOUND };
```

- `P2002` — unique constraint violated → 409
- `P2025` — record required but not found → 409's counterpart, 404

Two ways to produce a 409 exist and both are used deliberately:

- **Check first, then write.** Readable, but two callers can pass the check at
  the same time. Use it when the check needs to explain which constraint failed.
- **Write and let `P2002` surface.** Race-free, because the database is the
  arbiter. Use it for a plain uniqueness conflict.

`createSku` has two distinct conflicts — `uq_skus_code` across the whole store
and `uq_sku_variant` per product — and both come out as 409. If the client needs
to know which, the `detail` has to say so, and then the check-first form is the
one that can.

For a conditional update, the count is the check:

```ts
if (result.count !== 1) throw new ConflictException();
```

`updateMany` with the expected state in the `where` clause, then a count of zero
means the state changed underneath. See `src/products/products.service.ts:288`.

## Never do this on a 5xx

The filter discards any exception of its own that carries status 500 or above and
rebuilds a bare 500 with no `detail`. It logs the stack instead, scrubbed of
secret values. So:

- Never construct a 500 with a message intended for the client. It will not
  arrive, and writing it suggests otherwise to the next reader.
- Never put a database message, a Prisma message or an upstream error body into
  a response.
- 502 is declared on the payment operations for an upstream Stripe failure. It is
  a documented status with no detail, not an excuse to forward Stripe's body.

## Validation errors from code

```ts
import { ValidationProblemException } from '../common/problems';

throw new ValidationProblemException([{ field: 'skuIds', message: '...' }]);
```

An empty `field` means the error is about the request as a whole. Use this only
for a rule class-validator cannot express — a cross-field rule, or "at least one
property is required".
