# T-Shirt Store API

A NestJS service implementing the contract in [`api/openapi.yaml`](api/openapi.yaml):
23 paths, 28 operations, covering authentication, catalog, carts, orders and
Stripe payments.

**This repository currently contains the project base only.** The application
skeleton, cross-cutting concerns, tooling and infrastructure are in place; no
business feature is implemented yet. [Scope](#scope) lists both sides.

## Requirements

- Node.js 22 or newer
- Docker with Compose

## Getting started

```bash
cp .env.example .env
cp .env.test.example .env.test
cp .env.seed.example .env.seed

docker compose up -d          # PostgreSQL, Redis, Mailpit
npm install
npm run db:migrate            # applies the schema and the constraints migration
npm run db:seed               # a manager and the t-shirts category
npm run start:dev
```

The API is served under `/v1`, on `http://localhost:3000/v1` by default.

If your npm has `ignore-scripts=true` set globally (`npm config get
ignore-scripts`), the `postinstall` that generates the Prisma client does not
run, and neither does the `prepare` that installs the Husky hook. Run
`npm run db:generate` once after installing, and `npx husky` if you want the
pre-commit hook. Nothing else depends on a lifecycle script: the end-to-end
migration runs inside `test:e2e` rather than in a `pretest` hook, for exactly
this reason.

If port 5432 or 3000 is already taken on your machine, change `POSTGRES_PORT`
or `PORT` in `.env`, and keep the port inside `DATABASE_URL` in step with
`POSTGRES_PORT`.

Mailpit catches every mail sent during development; read it at
<http://localhost:8025>. Nothing leaves your machine.

### The seed is not optional

Two things the API cannot create through its own contract come from
`npm run db:seed`:

- **A manager.** `POST /auth/sign-up` returns a `ClientAuthSession` whose role
  is `const: client`, and no other operation creates a user. Without the seed,
  no manager-only endpoint can be exercised.
- **A category.** `products.category_id` is `NOT NULL`, there is no
  `POST /categories`, and `GET /products` documents that `category` matches
  "one exact seeded slug".

The seed's credentials live in `.env.seed`, which only `npm run db:seed` loads.
The running API has no use for the manager's password, and a value the process
never receives is a value it cannot leak.

## Scripts

| Script                            | What it does                                       |
| --------------------------------- | -------------------------------------------------- |
| `npm run start:dev`               | Run with reload                                    |
| `npm run lint`                    | ESLint as a check; fails on any problem or warning |
| `npm run lint:fix`                | ESLint with `--fix`                                |
| `npm run format` / `format:check` | Prettier write / check                             |
| `npm run typecheck`               | `tsc --noEmit`                                     |
| `npm run lint:api`                | Redocly against the delivered contract             |
| `npm test`                        | Unit tests                                         |
| `npm run test:e2e`                | End-to-end tests against a real PostgreSQL         |
| `npm run db:migrate`              | `prisma migrate dev`                               |
| `npm run db:migrate:deploy`       | `prisma migrate deploy`                            |
| `npm run db:seed`                 | Seed the manager and category                      |
| `npm run db:studio`               | Prisma Studio                                      |

## Layout

```
api/openapi.yaml          the delivered contract; frozen
docs/                     the database and lifecycle design
prisma/schema.prisma      16 models, 21 foreign keys, 3 enums
prisma/migrations/        generated DDL, then the hand-written constraints
src/config/               environment schema; the boot fails on a bad value
src/logging/              structured JSON logs, redaction, correlation id
src/prisma/               the database connection
src/common/               problem+json types and the global exception filter
src/auth/                 JWT, password hashing, the global guard, decorators
src/authorization/        the CASL ability factory and its guard
src/security/             the password-reset rate limit
src/storage/              the S3 upload primitive
src/mail/                 the SMTP transport
src/bootstrap.ts          every global concern, shared by main.ts and the tests
test/                     the end-to-end harness, fixtures, and truncation
```

## Contract details the base already enforces

Each one is cheap to get right now and expensive later, and getting one wrong
silently contradicts a contract that has already been delivered.

- **Validation returns 422, not 400.** 24 of the 28 operations document `422`;
  NestJS answers `400` by default.
- **Unknown properties are rejected.** 36 schemas declare
  `additionalProperties: false` and 9 declare `unevaluatedProperties: false`.
- **Errors are `application/problem+json`** (RFC 9457) with `type`, `title` and
  `status`. The `Problem` schema declares `unevaluatedProperties: false`, so the
  body carries nothing else. A correlation id goes to the log and the
  `X-Request-Id` header, never into the body.
- **Every route is served under `/v1`.**
- **JSON is camelCase, the database is snake_case**, via `@map` / `@@map` on
  every field and model.
- **Money is `decimal(10,2)`** in PostgreSQL and a string in JSON, never a
  JavaScript number.

## Database

`prisma migrate` creates 16 tables and 21 foreign keys. Three things Prisma
cannot express arrive in a hand-written migration applied after the generated
DDL: 18 CHECK constraints, 7 partial indexes, and the trigger that rejects every
physical `DELETE` on `products`.

```
prisma/migrations/20260828002527_constraints/migration.sql
```

Verify after migrating:

```sql
SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public' AND c.contype = 'c';                        -- 18
SELECT count(*) FROM pg_index WHERE indpred IS NOT NULL;                 -- 7
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;                  -- 1
```

## Testing

Unit tests and end-to-end tests are separate runs, on purpose: unit tests on
every save, end-to-end before a push and in CI.

The end-to-end suite drives a real application built with
`moduleFixture.createNestApplication()` and the same `configureApp` that
`main.ts` uses, so the global pipe, guards and filter under test are the ones
that ship. It runs against a real PostgreSQL, `tshirt_store_test`, which the
Compose init script creates alongside the development database. Between tests it
truncates every table rather than rolling back a transaction, because the
checkout path manages its own transactions. Each test then builds only the rows
it needs through the fixture helpers, so a test's setup is visible in the test.

`truncateAll` refuses to run against a database whose name does not end in
`_test`. That check exists because the failure it prevents already happened:
Prisma resolves its connection URL when the client is constructed, from its own
reading of `.env`, so a suite can report the test database in every
configuration value while connected to the development one.

## Scope

Built:

- Environment schema validation that fails the boot with a readable error
- The global exception filter, the validation pipe, and the `/v1` prefix
- Helmet, CORS, and a rate limit on the password-reset flow
- All seven authentication operations, including session revocation and email
- Product and SKU catalog operations, including public reads
- Product fallback and SKU-specific image uploads through S3
- CASL manager rules for product, SKU, and image writes
- Structured logging with redaction and a correlation id
- The unit and end-to-end harnesses, and CI

Deliberately absent:

- **The remaining business features.** Likes, carts, orders, payment intents,
  payment links, Stripe webhooks, and stock notifications are not implemented.
- **Any endpoint beyond the 28 in the contract.** No health route, no `/docs`
  route, no admin or reporting views.
- **The Redis consumer.** Redis runs in Compose because the stock-notification
  job is queue-based, but the queue lands with that job.
- **Stripe.** The SDK, the webhook route and signature verification are part of
  payments.

## Scenarios considered beyond the requirements

The requirements are what gets built. Where a literal requirement handles a real
case badly, the case is recorded here rather than quietly turned into extra
work, and implemented only with time left over.

### Implemented

- **The password-reset rate limit runs behind a platform router.** The limit
  counts per client IP, and Express reads that from the connection it receives.
  On Heroku that address belongs to the router, so unrelated users share one
  bucket and one caller locks out the rest. `TRUST_PROXY` now says how many
  proxies sit in front. Leaving it unset changes nothing; `true` is refused,
  because Express then reads the left-hand `X-Forwarded-For` value and Heroku
  appends to that header rather than replacing it.
- **Argon2id runs on a memory-limited dyno.** A safe hashing cost depends on the
  CPU and memory available to the deployment, so a hard-coded one either
  overloads a small dyno or wastes the capacity of a larger one.
  `PASSWORD_HASH_MEMORY_KIB`, `PASSWORD_HASH_TIME_COST` and
  `PASSWORD_HASH_PARALLELISM` make the cost adjustable per deployment, with
  defaults set to OWASP's 19 MiB, two-pass, one-lane baseline.
- **A secret appears inside an error message.** `pino` redacts by field path and
  cannot reach inside a string, so a Prisma connection failure prints the whole
  connection string, password included. The exception filter now censors
  configured secret values in any text it logs.
- **The application fails during start-up.** The global exception filter only
  sees errors on the request path; a configuration or database failure escapes
  it and Node prints the raw stack. The boot now catches that failure, censors
  it, and reports one structured line with a non-zero exit.
- **A deployment reuses the values from `.env.example`.** Those values are
  committed, so in production they are public strings in secret-shaped
  variables. The boot refuses them by exact value in production, and a test
  reads the templates and fails if a secret-shaped value there is not covered.
- **The manager password is only needed once.** The API held it for its whole
  lifetime for no reason. It now lives in `.env.seed`, which only
  `npm run db:seed` loads.
- **The end-to-end suite could truncate the wrong database.** Prisma resolves
  its URL when the client is constructed, from its own reading of `.env`, so the
  suite can report one database and be connected to another. `truncateAll` now
  refuses any database whose name does not end in `_test`. This one is not
  hypothetical: it emptied the development database once.

### Considered, not implemented

- **The rate limit counts per instance.** `@nestjs/throttler`'s built-in storage
  is in-process memory, so with N instances the effective limit is N times the
  configured one. A shared store belongs on the Redis that Compose already runs,
  and lands with the queue in week 4.
- **A stock notification cannot be retried.** `stock_notifications` records a
  send but cannot distinguish reserved, sent and failed, so a failed send is not
  recoverable. Fixing it would change the delivered ERD, so it belongs with the
  queue.
- **The contract could still be edited deliberately.** `redocly lint` catches
  degradation and `oasdiff` catches an incompatible change, which is what the
  brief asks for. Making the file literally immutable needs branch protection, a
  repository policy rather than code.
- **A caller asks for a very large page.** `GET /products` passes `limit`
  straight to the query, and the contract declares it `minimum: 1` with no
  maximum. Capping it here would reject requests the contract allows, so the
  bound belongs in the contract first.
- **Redaction reaches two levels of nesting.** `pino` matches redaction paths
  literally, with `*` standing for exactly one level. Logging the fields a line
  needs, rather than whole objects, avoids the question.

## Known limitations

Recorded here rather than discovered in review.

- **`npm audit` reports 3 high advisories**, all one chain: `prisma` →
  `@prisma/config` → `deepmerge-ts`. `@prisma/client` declares
  `dependencies: {}` and never loads any of it, so the vulnerable code never
  sits on the request path; it is CLI tooling used at migrate and generate time.
  It can still appear in a production dependency graph, because `prisma` is an
  optional peer of `@prisma/client`, so "not reachable from the running API" is
  the accurate claim, not "absent". The available fix is a downgrade to
  `prisma@6.12`, which npm itself flags as breaking; the real fix is tracked
  upstream.

## Design documents

| File                                                           | What it holds                                           |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/db.dbml`](docs/db.dbml)                                 | The data model: 16 tables, 21 foreign keys              |
| [`docs/data-lifecycle.md`](docs/data-lifecycle.md)             | States, deletion, stock, sessions, notifications        |
| [`docs/architecture.md`](docs/architecture.md)                 | Internal flows, lock order, queue design, monitoring    |
| [`docs/implementation-notes.md`](docs/implementation-notes.md) | What the database guarantees versus what only code does |
