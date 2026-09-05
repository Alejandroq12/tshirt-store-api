# T-Shirt Store API

A NestJS service that implements the contract in
[`api/openapi.yaml`](api/openapi.yaml): 23 paths and 28 operations covering
authentication, catalog, carts, orders and Stripe payments.

[Open the API contract in Swagger Editor](https://editor.swagger.io/?url=https%3A%2F%2Fraw.githubusercontent.com%2FAlejandroq12%2Ftshirt-store-api%2Fdev%2Fapi%2Fopenapi.yaml).

**All 28 HTTP operations are built.** Authentication, products, SKUs, image
uploads, likes, carts, orders, order history and both Stripe payment paths are
implemented, together with the required BullMQ stock-notification workflow.
Image upload needs an S3 bucket and AWS credentials to run.
[Scope](#scope) lists both sides.

## Deployment

The API is deployed at `https://t-shirt-api-2e742ec1e3f1.herokuapp.com/v1`.

Nothing answers at `/`, because the contract defines no route there. To check
that the service is up, list products. That operation is open to anonymous
callers, and the contract makes `limit` and `offset` required:

<https://t-shirt-api-2e742ec1e3f1.herokuapp.com/v1/products?limit=20&offset=0>

Password-reset and password-change emails go out through Mailtrap, from the
verified sending domain `quezadajulio.com`.

## Requirements

- Node.js 22 or newer
- Docker with Compose

## Getting started

```bash
cp .env.example .env
cp .env.test.example .env.test
cp .env.seed.example .env.seed

docker compose up -d      # PostgreSQL, Redis, Mailpit
npm install
npm run db:migrate        # schema, then the hand-written constraints
npm run db:seed           # a manager and the t-shirts category
npm run start:dev
```

The API runs under `/v1`, at `http://localhost:3000/v1` by default.

Mail sent while developing goes to Mailpit. Read it at
<http://localhost:8025>. Nothing leaves your machine.

Stripe calls require real test-mode values for `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`. Configure Stripe to send
`payment_intent.succeeded` and `checkout.session.completed` to
`/v1/webhooks/stripe`; locally, the Stripe CLI can forward those events and
provides the signing secret.

If port 5432 or 3000 is taken, change `POSTGRES_PORT` or `PORT` in `.env`. The
port inside `DATABASE_URL` has to match `POSTGRES_PORT`.

If `npm config get ignore-scripts` says `true`, two setup steps are skipped.
Run `npm run db:generate` to build the Prisma client, and `npx husky` if you
want the pre-commit hook.

### What the environment holds

There are three templates — `.env.example`, `.env.test.example` and
`.env.seed.example` — and `src/config/published-placeholders.spec.ts` reads all
of them from disk. It checks the variables whose name ends in `SECRET`,
`PASSWORD`, `KEY` or `TOKEN`: each such value has to be listed as a published
placeholder, which is what makes production refuse to boot on it. A secret held
under a name outside that pattern is not caught. `src/config/env.validation.ts` is the list the
application itself validates; the AWS SDK reads a few more of its own, noted
below.

Validation runs at boot and stops it on a bad value, rather than failing later
at the first request that needed it. Variables fall into four groups:

- **Required.** The database and Redis URLs, both JWT secrets and their TTLs,
  the reset-token TTL, the CORS allow-list, the store currency, the SMTP host
  and port, the sender address, the S3 region and bucket, and the three Stripe
  settings. Required means present and well-formed, not real: the placeholders
  in `.env.example` satisfy validation, which is what lets a fresh clone boot.
- **Defaulted.** `NODE_ENV`, `PORT`, `LOG_LEVEL`, `TRUST_PROXY`, `SMTP_SECURE`,
  the three Argon2 cost parameters, and the two password-reset rate-limit
  settings. Leaving them out is fine.
- **Optional.** `SMTP_USER` and `SMTP_PASSWORD`, which an unauthenticated relay
  such as the local Mailpit does not need; `AWS_ACCESS_KEY_ID` and
  `AWS_SECRET_ACCESS_KEY`; and `AWS_S3_PUBLIC_BASE_URL`, which only changes the
  host in a returned image URL.
- **Read by Compose, not by the application.** `POSTGRES_*`, `REDIS_PORT` and
  `MAILPIT_UI_PORT`.

Two things worth knowing before they surprise you:

- **The S3 client is constructed with a region and no credentials**, so it uses
  the AWS default provider chain. The two AWS variables above are one way to
  feed it; an instance role or a shared credentials file works as well, and
  `AWS_SESSION_TOKEN` is honoured by that chain even though the application
  never reads it by name. It is in the log redaction list for that reason.
- **The Stripe settings configure the payments module.** `REDIS_URL` connects
  BullMQ to the queue used by stock notifications and webhook reconciliation.
  Production additionally refuses to start when a secret still holds the value
  published in a template.

### The seed is not optional

Two things cannot be created through the API, so they come from
`npm run db:seed`:

- **A manager.** `POST /auth/sign-up` always creates a client, and no other
  operation creates a user. Without the seed you cannot call any manager-only
  endpoint.
- **A category.** Every product needs one, and there is no endpoint that
  creates categories.

Its credentials live in `.env.seed`, which only the seed loads. The running API
never receives the manager's password, so it cannot leak it.

## Scripts

| Script                            | What it does                            |
| --------------------------------- | --------------------------------------- |
| `npm run start:dev`               | Run with reload                         |
| `npm test`                        | Unit tests                              |
| `npm run test:e2e`                | End-to-end tests, against real Postgres |
| `npm run test:ci`                 | Unit tests with coverage thresholds     |
| `npm run lint`                    | ESLint. Fails on any problem or warning |
| `npm run lint:fix`                | ESLint with `--fix`                     |
| `npm run format` / `format:check` | Prettier, write or check                |
| `npm run typecheck`               | `tsc --noEmit`                          |
| `npm run lint:api`                | Redocly against the contract            |
| `npm run db:migrate`              | Apply migrations                        |
| `npm run db:seed`                 | Seed the manager and category           |
| `npm run db:studio`               | Browse the data in Prisma Studio        |

## Layout

```
api/openapi.yaml       the delivered contract. A pull request that breaks it fails CI
docs/                  the database and lifecycle design
prisma/schema.prisma   16 models, 21 foreign keys, 3 enums
prisma/migrations/     generated DDL, then the hand-written constraints
src/auth/              sign up, log in, sessions, password flows
src/products/          the product catalog
src/skus/              product variants
src/images/            image uploads
src/cart/              the client's cart and current-price totals
src/orders/            order snapshots and the core status lifecycle
src/payments/          Stripe links, intents and signed webhook processing
src/notifications/     stock cycles, BullMQ jobs and reconciliation
src/authorization/     CASL abilities and the guard that checks them
src/common/            problem+json types and the global exception filter
src/config/            environment schema. A bad value stops the boot
src/logging/           JSON logs, redaction, request ids
src/mail/              sending email
src/prisma/            the database connection
src/security/          the password-reset rate limit
src/storage/           uploading files to S3
src/bootstrap.ts       global setup, shared by main.ts and the tests
test/                  end-to-end suites, fixtures, table truncation
```

## What the contract forces

Getting any of these wrong would contradict a contract that was already
delivered.

- **Invalid input returns 422, not 400.** 24 of the 28 operations document 422.
  NestJS answers 400 by default.
- **Unknown properties are rejected.** 36 schemas say
  `additionalProperties: false`.
- **Errors are `application/problem+json`** with `type`, `title` and `status`,
  and nothing else. The request id goes in the `X-Request-Id` header and the
  logs, never in the body.
- **Every route lives under `/v1`.**
- **JSON is camelCase, the database is snake_case.**
- **Money is a string with two decimals**, stored as `decimal(10,2)`. Never a
  JavaScript number.

## Database

`prisma migrate` creates 16 tables and 21 foreign keys. Hand-written migrations
add the features Prisma cannot express: 18 CHECK constraints, 8 partial
indexes, and the trigger that blocks any physical `DELETE` on `products`.

```text
prisma/migrations/20260828002527_constraints/migration.sql
prisma/migrations/20260905000000_stock_notification_outbox/migration.sql
```

Check them after migrating:

```sql
SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public' AND c.contype = 'c';    -- 18
SELECT count(*) FROM pg_index WHERE indpred IS NOT NULL;    -- 8
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;     -- 1
```

## Testing

Unit tests and end-to-end tests run separately on purpose. Unit tests run on
every save. End-to-end tests run before a push and in CI.

The end-to-end suite builds the application the same way `main.ts` does, so the
pipe, guards and filter it tests are the ones that ship. It uses a real
PostgreSQL database, `tshirt_store_test`, created by the Compose init script
next to the development one.

Between tests it empties every table instead of rolling back a transaction,
because checkout manages its own transactions. Each test then creates
only the rows it needs, through the fixture helpers, so you can read a test and
see its setup.

`truncateAll` refuses any database whose name does not end in `_test`. That
check exists because the mistake already happened once: Prisma reads its
connection URL from its own `.env` when the client is created, so a suite can
report the test database while being connected to the development one.

## Scope

Built:

- All seven authentication operations, with session revocation and email
- Products and SKUs, with public reads
- Image upload to S3, with content type and size checks
- Orders and filtered client order history
- Stripe Payment Links, Payment Intents and idempotent signed webhooks
- BullMQ stock notifications and scheduled webhook reconciliation
- CASL rules for manager writes on products, SKUs and images, order access,
  and clients managing their likes, cart and orders
- Environment validation that stops the boot on a bad value
- The global exception filter, the validation pipe and the `/v1` prefix
- Helmet, CORS, and a rate limit on the password-reset flow
- JSON logging with redaction and a request id
- Unit and end-to-end suites, and CI

Not built:

- **Anything beyond the 28 operations in the contract.** No health route, no
  `/docs` route, no admin views.

## Where the requirements needed interpretation

Three requirements admitted more than one reading, and one piece of review
feedback did not say which endpoint it meant. These are the readings this
implementation took, so a reviewer can disagree with the choice rather than
having to discover it.
[`docs/implementation-notes.md`](docs/implementation-notes.md) records the
alternative that was rejected in each case and why.

- **"Delete products"** is `PATCH` with `status: retired`, not `DELETE`. Orders
  reference products, so a hard delete would either orphan an order line or take
  a customer's purchase history with it. A database trigger enforces the reading.
- **"Disable products"** implies a state to return to, so products have three
  states rather than two: `active`, `inactive`, `retired`. Only `inactive` is
  named by a requirement.
- **"Variant-specific images"** became a many-to-many between images and SKUs
  with a product-level fallback, because one photograph usually covers several
  sizes of a colour and the alternative duplicates the S3 object per SKU.
- **The endpoint removed as unnecessary** was `GET /manager/products`. The
  feedback did not name which one; everything it offered is reachable through
  `GET /products` as an authenticated manager.

## Decisions worth knowing

Cases the requirements do not name, where the plain reading would have left
something broken.

- **`TRUST_PROXY`.** The password-reset rate limit counts per client IP, and
  Express reads that from the connection it receives. Behind a router like
  Heroku's, every request looks like it comes from the same address, so one
  caller would lock out everyone. This setting says how many proxies sit in
  front. Left unset it changes nothing. `true` is refused, because Express then
  reads the value on the left of `X-Forwarded-For`, and Heroku adds to that
  header instead of replacing it.
- **`PASSWORD_HASH_*`.** A safe Argon2id cost depends on the machine. A fixed
  one either overloads a small dyno or wastes a bigger one. The defaults are
  OWASP's baseline of 19 MiB, two passes, one lane.
- **Secrets inside error text.** `pino` hides fields by name, but it cannot
  reach inside a string, and a Prisma connection error prints the whole
  connection string. The exception filter replaces known secret values in any
  text it logs.
- **Failures during start-up.** The exception filter only sees errors on the
  request path. A bad configuration or an unreachable database escapes it, and
  Node prints the raw stack. The boot now catches that, hides the secrets, and
  writes one JSON line before exiting with a non-zero code.
- **Values copied from `.env.example`.** Those values are in the repository, so
  in production they are public strings sitting in secret variables. The boot
  refuses them by exact value, and a test reads the templates and fails if a new
  secret is not covered.

## Known limitations

- **`npm audit` reports 3 high advisories**, all in one chain:
  `prisma` → `@prisma/config` → `deepmerge-ts`. Every non-breaking fix has been
  applied, so these three are what remains rather than what has been ignored —
  `npm audit fix` makes no further change.
  `@prisma/client` has no dependencies and never loads any of it, so the
  vulnerable code is not reachable from the running API. It is CLI tooling used
  when migrating and generating. It can still show up in a production
  dependency graph, because `prisma` is an optional peer of `@prisma/client`.
  The only remaining fix is downgrading to `prisma@6.12`, which npm flags as
  breaking. The real fix is tracked upstream.
- **Stock-notification email delivery is at least once.** PostgreSQL records a
  pending notification before BullMQ receives its id, so a Redis outage cannot
  lose the email. If a worker sends the email and dies before recording
  `sent_at`, reconciliation sends it again. Marking it first would trade a
  possible duplicate for a permanently lost required notification.
- **Reconciliation has no dead-letter cutoff.** The requirement is to retry
  every Stripe event whose `processed_at` is null. A permanently invalid event
  therefore remains pending and requires operator intervention; applying an age
  limit could also abandon a recoverable payment.
- **Page size has no upper bound.** The contract's `limit` parameter is
  `minimum: 1` with no `maximum`, so `GET /products?limit=1000000` and
  `GET /orders?limit=1000000` are requests the delivered contract accepts, and
  the service loads that page — orders with all of their items. A cap would be
  the obvious hardening, and it is deliberately absent: adding one would make the
  API answer 422 to a request the contract permits, which is a contract break
  rather than a fix. The place to solve it is the contract, not the DTO.
- **The rate limit counts per instance.** The throttler keeps its counters in
  memory, so running more than one instance multiplies the effective limit. A
  shared counter would require a Redis-backed throttler store; the stock queue
  does not change this limitation.
- **A failed insert can leave an active Payment Link with no local row.**
  `POST /payment-links` creates the link at Stripe before storing it, so a
  database failure in that window leaves a live, payable URL the API never
  returned. Paying it produces a signed event that matches no `payment_links`
  row, which the webhook stores unprocessed with its error and answers 204 —
  the money is captured and visible, not lost. The scheduled reconciliation
  producer retries events with `processed_at IS NULL`; an operator still has to
  repair the missing local link before this particular event can succeed.
  Deactivating the link in a compensating catch would narrow the window, not
  close it, because that call can fail too.
- **`STORE_CURRENCY` is only correct for two-decimal currencies.** Amounts
  reach Stripe as `value × 100`, which is wrong for a zero-decimal currency
  such as JPY. The contract permits any ISO code in `Currency` but its `Amount`
  pattern is `^(0|[1-9]\d{0,7})\.\d{2}$` and the column is `decimal(10,2)`, so
  a zero-decimal currency cannot be represented in a conforming response
  either. Supporting one is a contract change, not a service change.
- **The webhook trusts the amount on a verified Stripe event.** A
  `payment_intent.succeeded` event is applied to its order without comparing
  `amount_received` against the frozen total, so an intent repriced through the
  Stripe API between creation and confirmation would mark the order paid for
  the wrong amount. Signature verification authenticates the sender, not the
  figure: `STRIPE_WEBHOOK_SECRET` and `STRIPE_SECRET_KEY` are separate trust
  boundaries, and the comparison would also catch a divergence with no attacker
  at all — an operator acting in the Dashboard, or a later code path that
  creates intents elsewhere. This is accepted residual risk rather than a
  defended position; the Payment Link path takes the opposite approach and
  records what Stripe charged.

## Design documents

| File                                                           | What it holds                                         |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| [`docs/db.dbml`](docs/db.dbml)                                 | The data model: 16 tables, 21 foreign keys            |
| [`docs/data-lifecycle.md`](docs/data-lifecycle.md)             | States, deletion, stock, sessions, notifications      |
| [`docs/architecture.md`](docs/architecture.md)                 | Production diagram, deployment, queue, monitoring     |
| [`docs/implementation-notes.md`](docs/implementation-notes.md) | What the database guarantees, and what only code does |
| [`docs/agentic-workflow.md`](docs/agentic-workflow.md)         | How the repository is worked on with Claude Code      |
