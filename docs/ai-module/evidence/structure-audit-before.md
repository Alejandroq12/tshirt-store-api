# Structure audit — before

`.claude/skills/structure-audit/scripts/audit.sh` on root `src`, limit 10.

## Folders over the limit

| Folder               | Files | Limit | Responsibilities mixed inside                                     |
| -------------------- | ----- | ----- | ----------------------------------------------------------------- |
| `src/auth`           | 14    | 10    | the 7 `Authentication` operations, password hashing, opaque reset secrets, JWT issuing |
| `src/notifications`  | 12    | 10    | stock notification cycle, BullMQ stock producer/worker, Stripe reconciliation producer/worker |
| `src/payments`       | 11    | 10    | Payment Link and Payment Intent creation, the Stripe client, signed webhook processing |

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

## Imports outside the folder that will change

`grep -rn "from '.*/<folder>/" src test --include='*.ts'`. Only the lines that
name a file that moves are listed; every folder's own `./` imports change too.

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
