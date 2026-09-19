# Structure audit — before

`.claude/skills/structure-audit/scripts/audit.sh` on root `src`, limit 10 files
and 3 stems; the script output is `structure-audit-before.txt`. The proposals
are session A's. The mark, stem and crossing columns, the order and the
verdicts for the `mixed` folders were added when the audit gained those
measures.

## Folders the check does not mark ok

| Folder | Mark | Files | Stems | Crossings | Responsibilities mixed inside |
| --- | --- | --- | --- | --- | --- |
| `src/payments` | OVER | 11 | 5 | 6 | Payment Link and Payment Intent creation, the Stripe client, signed webhook processing |
| `src/logging` | mixed | 7 | 4 | 6 | pino module, redaction paths, request logging, secret scrubber |
| `src/storage` | mixed | 6 | 4 | 9 | S3 primitive, upload limits, barrel |
| `src/notifications` | OVER | 12 | 4 | 22 | stock notification cycle, BullMQ stock producer/worker, Stripe reconciliation producer/worker |
| `src/authorization` | mixed | 6 | 5 | 34 | CASL types, factory, registry spec, module, barrel |
| `src/config` | mixed | 8 | 5 | 34 | env schema, seed env schema, published placeholders, module, barrel |
| `src/auth` | OVER | 14 | 6 | 50 | the 7 `Authentication` operations, password hashing, opaque reset secrets, JWT issuing |

Safest first, fewest crossings: `payments`, then `notifications`, then `auth`
among the `OVER` folders, and the commits took that order. The `mixed` folders
stay; the verdicts are below the proposals.

## Proposed tree

### `src/auth` — 14 loose files → 8 at the root

```text
src/auth/
  auth.module.ts              module stays at the folder root
  index.ts                    barrel, re-exports every group
  authenticated-user.ts       shared: guards/, token.service, auth.service and 9 other folders
  auth.controller.ts          the 7 operations of the Authentication tag
  auth.controller.spec.ts
  auth.dto.ts
  auth.service.ts             serves both the session and the password flows, so it cannot split
  auth.service.spec.ts
  credentials/                what the user presents and the service verifies
    password.service.ts       Argon2id — CLAUDE.md: "Argon2id passwords"
    password.service.spec.ts
    secret-token.service.ts   random secret plus sha256 digest, used by the reset flow
    secret-token.service.spec.ts
  tokens/                     README: "login, JWTs, sessions"
    token.service.ts          access and refresh JWTs bound to a session row
    token.service.spec.ts
  decorators/                 exists
  guards/                     exists
```

`secret-token.service.ts` sits in `credentials/` and not in `tokens/` despite the
stem: it mints the opaque password-reset secret, it does not issue a JWT.

### `src/notifications` — 12 loose files → 2 at the root

```text
src/notifications/
  notifications.module.ts
  stock-notification.queue.ts     shared: both producers, both workers, test/checkout.e2e-spec.ts
  stock-notifications/            architecture.md: "BullMQ processors — stock notifications"
    stock-cycle.service.ts
    stock-cycle.service.spec.ts
    stock-notification.producer.ts
    stock-notification.producer.spec.ts
    stock-notification.worker.ts
    stock-notification.worker.spec.ts
  reconciliation/                 architecture.md: "scheduled reconciliation scan every 30 seconds"
    reconciliation.producer.ts
    reconciliation.producer.spec.ts
    reconciliation.worker.ts
    reconciliation.worker.spec.ts
```

### `src/payments` — 11 loose files → 3 at the root

```text
src/payments/
  payments.module.ts
  stripe.client.ts                shared: payments.service and stripe-webhook.service
  payments.controllers.spec.ts    shared: covers all three controllers, both groups
  links-and-intents/              CLAUDE.md: "Stripe links, intents and signed webhooks"
    payment-links.controller.ts
    payment-intents.controller.ts
    payments.dto.ts
    payments.service.ts
    payments.service.spec.ts
  webhooks/                       contract tag "Webhooks"; architecture.md: "signed webhooks"
    stripe-webhook.controller.ts
    stripe-webhook.service.ts
    stripe-webhook.service.spec.ts
```

## Folders marked mixed, and why each stays

| Folder | Files | Stems | Crossings | Verdict |
| --- | --- | --- | --- | --- |
| `src/authorization` | 6 | 5 | 34 | Stays. One concern, the CASL mechanism `CLAUDE.md` describes: the ability types, the factory and its spec, the spec of what every feature registers, the module and the barrel. Five stems would become five folders of one file, and 34 crossing lines would change for it. |
| `src/config` | 8 | 5 | 34 | Stays. One concern, the environment schema that fails the boot: three validators (`env`, `seed-env`, `published-placeholders`) with their specs, the module and the barrel. |
| `src/logging` | 7 | 4 | 6 | Stays. One concern, logging: `redaction`, `request-logging` and `secret-scrubber` are each a file and its spec beside the module. Grouping the pairs gives folders of two files. |
| `src/storage` | 6 | 4 | 9 | Stays. One concern, the S3 primitive and the upload limits it enforces, which `images/` imports directly. |

The check reports a `mixed` folder on every run and the audit lists it; the
verdict is revisited when the folder crosses the file limit, which the check
then reports as `OVER`.

## Imports outside the folder that will change

`SHOW=1 .claude/skills/structure-audit/scripts/audit.sh` prints the lines
behind each score. Only the lines that name a file that moves are listed;
every folder's own `./` imports change too.

### `src/auth`

```text
test/auth-notification-failure.e2e-spec.ts:5:import { PasswordService } from '../src/auth/password.service';
test/auth-notification-failure.e2e-spec.ts:6:import { SecretTokenService } from '../src/auth/secret-token.service';
test/auth.e2e-spec.ts:6:import { PasswordService } from '../src/auth/password.service';
test/auth.e2e-spec.ts:7:import { SecretTokenService } from '../src/auth/secret-token.service';
test/http-contract.e2e-spec.ts:7:import { TokenService } from '../src/auth/token.service';
```

The 44 other external lines name `auth/authenticated-user`, `auth/decorators/*`,
`auth/guards/*` or `auth/auth.module` and do not change.

### `src/notifications`

```text
src/authorization/registered-abilities.spec.ts:9:import { ReconciliationProducer } from '../notifications/reconciliation.producer';
src/authorization/registered-abilities.spec.ts:10:import { StockCycleService } from '../notifications/stock-cycle.service';
src/authorization/registered-abilities.spec.ts:11:import { StockNotificationProducer } from '../notifications/stock-notification.producer';
src/orders/orders.service.ts:23:import { StockCycleService } from '../notifications/stock-cycle.service';
src/orders/orders.service.ts:24:import { StockNotificationProducer } from '../notifications/stock-notification.producer';
src/orders/orders.service.spec.ts:16:import type { StockCycleService } from '../notifications/stock-cycle.service';
src/orders/orders.service.spec.ts:17:import type { StockNotificationProducer } from '../notifications/stock-notification.producer';
src/payments/payments.module.ts:7:import { ReconciliationWorker } from '../notifications/reconciliation.worker';
src/payments/stripe-webhook.service.ts:7:import { StockCycleService } from '../notifications/stock-cycle.service';
src/payments/stripe-webhook.service.ts:8:import { StockNotificationProducer } from '../notifications/stock-notification.producer';
src/payments/stripe-webhook.service.spec.ts:7:import type { StockCycleService } from '../notifications/stock-cycle.service';
src/payments/stripe-webhook.service.spec.ts:8:import type { StockNotificationProducer } from '../notifications/stock-notification.producer';
src/skus/skus.service.ts:7:import { StockCycleService } from '../notifications/stock-cycle.service';
src/skus/skus.service.ts:8:import { StockNotificationProducer } from '../notifications/stock-notification.producer';
src/skus/skus.service.spec.ts:7:import type { StockCycleService } from '../notifications/stock-cycle.service';
src/skus/skus.service.spec.ts:8:import type { StockNotificationProducer } from '../notifications/stock-notification.producer';
```

`NotificationsModule` imports (`src/app.module.ts:10`, `src/orders/orders.module.ts:6`,
`src/payments/payments.module.ts:6`, `src/skus/skus.module.ts:6`,
`src/authorization/registered-abilities.spec.ts:8`) and
`test/checkout.e2e-spec.ts:15` (the queue file) do not change.

### `src/payments`

```text
src/notifications/reconciliation.worker.ts:6:import { StripeWebhookService } from '../payments/stripe-webhook.service';
src/notifications/reconciliation.worker.spec.ts:4:import type { StripeWebhookService } from '../payments/stripe-webhook.service';
```

`src/app.module.ts:12`, `src/authorization/registered-abilities.spec.ts:13`
(`PaymentsModule`), `src/authorization/registered-abilities.spec.ts:14` and
`test/support/create-test-app.ts:7` (`StripeClient`) do not change.

## Documentation that draws the layout

`grep -n "<folder>/" CLAUDE.md README.md`

```text
CLAUDE.md:81:  auth/            7 operations, JWT bound to a session row, Argon2id passwords
CLAUDE.md:88:  payments/        Stripe links, intents and signed webhooks
CLAUDE.md:89:  notifications/   stock cycles, BullMQ workers and reconciliation
README.md:68:src/auth/              login, JWTs, sessions, and password flows
README.md:74:src/payments/          Stripe links, intents, and webhooks
README.md:75:src/notifications/     stock cycles, BullMQ jobs, and reconciliation
```
