# T-Shirt Store API — working agreement

NestJS 11 + Prisma 6 + PostgreSQL 17 service that implements
[`api/openapi.yaml`](api/openapi.yaml). The contract is the specification; the
code follows it, never the other way around.

## The scope rule — read this before proposing anything

This repository is a training deliverable evaluated against a fixed set of
requirements. Work that no requirement asks for is not an improvement here, it
is a defect. The rule has three parts and the third is the one that gets
dropped:

1. **Align to the requirement.** The literal requirement is what gets built.
2. **Document the scenario.** When the literal requirement handles a case
   badly, write the case down. Noticing is worth something; writing it down is
   how that shows.
3. **Implement the extra only if there is time left over** — after the
   requirements are done. Not "it was quick", not "it was already half-built".

### What counts as an anchor

Only these, and only as a quotable sentence:

| Source                                                         | What it anchors                                 |
| -------------------------------------------------------------- | ----------------------------------------------- |
| [`api/openapi.yaml`](api/openapi.yaml)                         | Every operation, status code and payload        |
| [`docs/architecture.md`](docs/architecture.md)                 | Required controls and the payment/webhook flows |
| [`docs/data-lifecycle.md`](docs/data-lifecycle.md)             | State machines and relationship rules           |
| [`docs/implementation-notes.md`](docs/implementation-notes.md) | The numbered application-level rules            |
| [`docs/db.dbml`](docs/db.dbml)                                 | The data model                                  |

Each operation in the contract carries `x-requirement` (which requirement it
serves) and `x-authorization` (who may call it). Quote those instead of
re-deriving them.

**These are not anchors:** "good practice", "OWASP recommends", "a senior
reviewer would flag it", "it makes X work properly", "it was cheap", "a review
asked for it". A review finding something real does not turn it into a
requirement.

If you cannot quote a sentence, the answer is to write the scenario into the
README under _Decisions worth knowing_ or _Known limitations_ — not to build it.
Run `/anchor <thing>` when unsure.

## Never commit

Do not run `git commit`, `git push`, `git tag` or `git reset --hard`. The
repository owner authors every commit. When work is ready, hand over a proposed
commit breakdown and a PR description instead — `/pr` does this. A `PreToolUse`
hook blocks these commands, so attempting one wastes a turn.

## Commands

| Task              | Command                                 |
| ----------------- | --------------------------------------- |
| Full CI gate      | `/verify` (or the seven below in order) |
| Lint              | `npm run lint`                          |
| Formatting        | `npm run format:check`                  |
| Types             | `npm run typecheck`                     |
| Contract lint     | `npm run lint:api`                      |
| Build             | `npm run build`                         |
| Unit tests        | `npm test` / `npm run test:ci`          |
| End-to-end tests  | `npm run test:e2e`                      |
| Migrate (dev)     | `npm run db:migrate`                    |
| Migrate (test DB) | `npm run db:migrate:test`               |
| Seed              | `npm run db:seed`                       |

`npm run test:e2e` runs `db:migrate:test` first and needs `.env.test` plus a
running PostgreSQL (`docker compose up -d`). It runs `--runInBand` because the
specs truncate tables.

Coverage thresholds are enforced: statements 85, branches 75, functions 80,
lines 85. `index.ts`, `main.ts`, `bootstrap.ts` and `*.module.ts` are excluded
from coverage collection.

## Layout

```text
src/
  auth/            7 operations, JWT bound to a session row, Argon2id passwords
  authorization/   CASL mechanism only — no rules live here
  products/        catalogue reads plus manager writes
  skus/            variants, money as decimal strings
  images/          S3 upload, fallback vs. per-SKU assignment
  cart/            client cart and current-price totals
  orders/          order snapshots, history and status lifecycle
  payments/        Stripe links, intents and signed webhooks
  notifications/   stock cycles, BullMQ workers and reconciliation
  common/          Problem Details filter, problem types, validation helpers
  config/          environment schema that fails the boot
  logging/         pino, redaction paths, secret scrubber
  mail/            SMTP transport
  prisma/          PrismaService
  security/        rate-limit module
  storage/         S3 primitive
  bootstrap.ts     configureApp() — shared by main.ts and the e2e harness
  main.ts          NestFactory, listen, and a startup-failure handler
test/              *.e2e-spec.ts plus support/ helpers
api/openapi.yaml   the contract — 28 operations
docs/              architecture, data lifecycle, implementation notes, DBML
mcp/               the contract MCP server used by this repository's tooling
```

Unit specs live next to their subject as `*.spec.ts` inside `src/`. End-to-end
specs live in `test/` as `*.e2e-spec.ts` with their own Jest config.

## Conventions that are not negotiable

- **Every error is `application/problem+json`.** `ProblemExceptionFilter`
  catches everything. A response with status ≥ 500 carries no `detail` — the
  filter discards the original and rebuilds a bare 500, logging the scrubbed
  stack. Never add a `detail` to a server error.
- **Money is a string,** `decimal(10,2)`, matching
  `^(0|[1-9]\d{0,7})\.\d{2}$`. Never a JavaScript number, at any layer.
- **Validation returns 422,** not 400. `ValidationPipe` runs with
  `whitelist: true` and `forbidNonWhitelisted: true`, so an unknown property is
  a rejection, not something ignored.
- **Security is on by default.** `JwtAuthGuard` is registered as `APP_GUARD`
  from `AuthModule`, so every route is authenticated unless it opts out with
  `@Public()` or `@OptionalAuth()`.
- **CASL rules are registered by the feature that owns them,** through a private
  `@Injectable()` registrar implementing `OnModuleInit` that calls
  `CaslAbilityFactory.register`. `src/authorization/` holds the mechanism and no
  rules. Enforce at the controller with `@CheckAbilities()`.
- **There is no `DELETE` for products or SKUs.** Retiring a product is
  `PATCH` with `status: retired`; a database trigger rejects a physical delete.
- **Secrets never reach a log.** A new secret-shaped environment variable must
  be added to `SECRET_VARIABLES` in `src/logging/redaction.ts`, and its
  `.env.example` value must appear in `PUBLISHED_PLACEHOLDERS` in
  `src/config/published-placeholders.ts` — a spec reads the templates from disk
  and fails otherwise.
- **Controller method names match the contract's `operationId` exactly.** The
  repository's tooling relies on this to tell implemented operations from
  planned ones.

## Adding an operation

Use the `nest-operation` skill. It carries the file order, the naming, the error
mapping and the test expectations for this codebase.

## Reading environment files

`.env`, `.env.test` and `.env.seed` hold real credentials and a `PreToolUse`
hook blocks reading them. Read `.env.example`, `.env.test.example` or
`.env.seed.example` instead — same keys, placeholder values.

## Style

Prose in comments and documentation is plain and specific: say what the code
does and why the non-obvious choice was made. No filler, no "Note that", no
restating the code in English. Match the surrounding density. Comments explain
decisions, not syntax.
