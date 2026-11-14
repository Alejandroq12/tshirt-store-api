# Structure audit — layout

`.claude/skills/structure-audit/scripts/audit.sh` on root `src`, limit 10 files
and 3 stems; the script output is `structure-audit-layout.txt`. No folder is
over the limit: this regrouping answers the reviewer's layout feedback, not the
rule. Every slice that serves contract operations takes one shape — the module,
the controllers and the DTO at the root, every injectable provider in
`services/`, the response interfaces in `types/` — and `AuthenticatedUser`
becomes `SessionPrincipal`, the user and session a request runs as.

## Folders the check does not mark ok

| Folder | Mark | Files | Stems | Crossings | Responsibilities mixed inside |
| --- | --- | --- | --- | --- | --- |
| `src/logging` | mixed | 7 | 4 | 6 | pino module, redaction paths, request logging, secret scrubber |
| `src/storage` | mixed | 6 | 4 | 9 | S3 primitive, upload limits, barrel |
| `src/authorization` | mixed | 6 | 5 | 34 | CASL types, factory, registry spec, module, barrel |
| `src/config` | mixed | 8 | 5 | 34 | env schema, seed env schema, published placeholders, module, barrel |

All four stay, for the reasons `structure-audit-before.md` records: each is one
concern under several stems, and none serves a contract operation. They are not
slices and the shape below does not apply to them; neither does it apply to
`notifications`, which has no controller and keeps its `stock-cycle/`,
`delivery/` and `reconciliation/` pipelines, nor to the `mail`, `prisma` and
`storage` adapters.

## The shape, and the order

A slice is a feature module with a controller: `auth`, `products`, `skus`,
`images`, `cart`, `orders`, `payments`. Each ends as:

```text
src/<slice>/
  <slice>.module.ts            wiring and the CASL registrar, untouched
  <slice>.controller.ts        every controller, with its spec, at the root
  <slice>.dto.ts               what comes in; validation classes, not types
  services/                    every @Injectable() provider, with its spec
  types/<slice>.types.ts       the response interfaces the service file held
```

`index.ts`, `guards/` and `decorators/` stay where they exist. The order is by
lines outside the slice that name a moving file, fewest first, so each slice
leaves the gate green before the next one moves: `cart` 0, `images` 1,
`skus` 1, `orders` 1, `products` 2, `payments` 4, `auth` 34.

## Proposed tree

### `src/cart`

```text
src/cart/
  cart.module.ts
  cart.controller.ts
  cart.controller.spec.ts
  cart.dto.ts
  services/
    cart.service.ts
    cart.service.spec.ts
  types/
    cart.types.ts               CartItemResponse, CartResponse
```

### `src/images`

```text
src/images/
  images.module.ts
  images.controller.ts
  images.controller.spec.ts
  images.dto.ts
  images.dto.spec.ts
  services/
    images.service.ts
    images.service.spec.ts
  types/
    images.types.ts             ImageAssetResponse
```

### `src/skus`

```text
src/skus/
  skus.module.ts
  skus.controller.ts
  skus.controller.spec.ts
  skus.dto.ts
  services/
    skus.service.ts
    skus.service.spec.ts
  types/
    skus.types.ts               SkuResponse, SkuDetailResponse
```

### `src/orders`

```text
src/orders/
  orders.module.ts
  orders.controller.ts
  orders.controller.spec.ts
  my-orders.controller.ts
  my-orders.controller.spec.ts
  orders.dto.ts
  services/
    orders.service.ts
    orders.service.spec.ts
  types/
    orders.types.ts             OrderItemResponse, OrderResponse, OrderPageResponse
```

### `src/products`

```text
src/products/
  products.module.ts
  products.controller.ts
  products.controller.spec.ts
  products.dto.ts
  services/
    products.service.ts
    products.service.spec.ts
  types/
    products.types.ts           ProductResponse, LikeStateResponse, ProductPageResponse, ProductDetailResponse
```

### `src/payments` — `methods/`, `webhook/` and `stripe/` fold into the shape

```text
src/payments/
  payments.module.ts
  payment-intents.controller.ts
  payment-links.controller.ts
  stripe-webhook.controller.ts
  payments.controllers.spec.ts  covers the three controllers, so it sits with them
  payments.dto.ts
  services/
    payments.service.ts
    payments.service.spec.ts
    stripe-webhook.service.ts
    stripe-webhook.service.spec.ts
    stripe.client.ts            the SDK façade is an @Injectable() provider, so it is a service here
  types/
    payments.types.ts           PaymentLinkResponse, PaymentIntentResponse
```

PR #19 grouped this slice by flow. The reviewer's shape groups by kind, and the
two cannot coexist without a `services/` inside every flow folder, which is
deeper than either. The root keeps four stems — three controllers and the
module — which the check reports as `mixed` at 6 files; see the verdicts below.

### `src/auth` — `credentials/` folds into `services/`

```text
src/auth/
  auth.module.ts
  auth.controller.ts
  auth.controller.spec.ts
  auth.dto.ts
  index.ts                      barrel, re-exports every group
  decorators/                   exists
  guards/                       exists
  services/
    auth.service.ts
    auth.service.spec.ts
    password.service.ts         Argon2id
    password.service.spec.ts
    secret-token.service.ts     the opaque password-reset secret
    secret-token.service.spec.ts
    token.service.ts            access and refresh JWTs bound to a session row
    token.service.spec.ts
  types/
    auth.types.ts               UserResponse, AuthSessionResponse, AccessTokenResponse
    session-principal.ts        SessionPrincipal, was AuthenticatedUser; and the Express Request augmentation
    token.types.ts              AccessTokenClaims, RefreshTokenClaims, IssuedToken, SessionSubject
```

`session-principal.ts` is the one type file without a `.types` suffix: it holds
one interface named after the file, the way `authenticated-user.ts` did.

## Folders the proposal leaves mixed, and why each stays

| Folder | Files | Stems | Verdict |
| --- | --- | --- | --- |
| `src/auth/services` | 8 | 4 | Stays. The shape puts every provider of the slice in one folder; four two-file services are four stems by construction. Under the file limit. |
| `src/payments` | 6 | 4 | Stays. The shape puts every controller at the root; three endpoints plus the module are four stems by construction. Under the file limit. |

## Proposal, as paths

`structure-check` verifies every line: the path exists, or a deviation below
says where it went and why.

```proposal
src/cart/cart.module.ts
src/cart/cart.controller.ts
src/cart/cart.controller.spec.ts
src/cart/cart.dto.ts
src/cart/services/cart.service.ts
src/cart/services/cart.service.spec.ts
src/cart/types/cart.types.ts
src/images/images.module.ts
src/images/images.controller.ts
src/images/images.controller.spec.ts
src/images/images.dto.ts
src/images/images.dto.spec.ts
src/images/services/images.service.ts
src/images/services/images.service.spec.ts
src/images/types/images.types.ts
src/skus/skus.module.ts
src/skus/skus.controller.ts
src/skus/skus.controller.spec.ts
src/skus/skus.dto.ts
src/skus/services/skus.service.ts
src/skus/services/skus.service.spec.ts
src/skus/types/skus.types.ts
src/orders/orders.module.ts
src/orders/orders.controller.ts
src/orders/orders.controller.spec.ts
src/orders/my-orders.controller.ts
src/orders/my-orders.controller.spec.ts
src/orders/orders.dto.ts
src/orders/services/orders.service.ts
src/orders/services/orders.service.spec.ts
src/orders/types/orders.types.ts
src/products/products.module.ts
src/products/products.controller.ts
src/products/products.controller.spec.ts
src/products/products.dto.ts
src/products/services/products.service.ts
src/products/services/products.service.spec.ts
src/products/types/products.types.ts
src/payments/payments.module.ts
src/payments/payment-intents.controller.ts
src/payments/payment-links.controller.ts
src/payments/stripe-webhook.controller.ts
src/payments/payments.controllers.spec.ts
src/payments/payments.dto.ts
src/payments/services/payments.service.ts
src/payments/services/payments.service.spec.ts
src/payments/services/stripe-webhook.service.ts
src/payments/services/stripe-webhook.service.spec.ts
src/payments/services/stripe.client.ts
src/payments/types/payments.types.ts
src/auth/auth.module.ts
src/auth/auth.controller.ts
src/auth/auth.controller.spec.ts
src/auth/auth.dto.ts
src/auth/index.ts
src/auth/decorators/current-user.decorator.ts
src/auth/decorators/current-user.decorator.spec.ts
src/auth/decorators/optional-auth.decorator.ts
src/auth/decorators/public.decorator.ts
src/auth/guards/jwt-auth.guard.ts
src/auth/guards/jwt-auth.guard.spec.ts
src/auth/services/auth.service.ts
src/auth/services/auth.service.spec.ts
src/auth/services/password.service.ts
src/auth/services/password.service.spec.ts
src/auth/services/secret-token.service.ts
src/auth/services/secret-token.service.spec.ts
src/auth/services/token.service.ts
src/auth/services/token.service.spec.ts
src/auth/types/auth.types.ts
src/auth/types/session-principal.ts
src/auth/types/token.types.ts
```

## Deviations

One per line, `proposed -> actual: reason`; a prefix that ends in `/` maps
every file under that folder.

```deviations
```

## Imports outside the slice that name a file that moves

The audit script scores only the folders it prints, and every slice is `ok`,
so these were listed with the same resolution rule by hand: a line outside the
slice whose quoted path lands on a file the proposal moves. The paths are the
ones before any move.

```text
test/images.e2e-spec.ts:8:'../src/images/images.service'
test/skus.e2e-spec.ts:8:'../src/skus/skus.service'
test/order-history.e2e-spec.ts:14:'../src/orders/orders.service'
test/images.e2e-spec.ts:9:'../src/products/products.service'
test/products.e2e-spec.ts:13:'../src/products/products.service'
src/notifications/reconciliation/reconciliation.worker.spec.ts:4:'../../payments/webhook/stripe-webhook.service'
src/notifications/reconciliation/reconciliation.worker.ts:6:'../../payments/webhook/stripe-webhook.service'
src/authorization/registered-abilities.spec.ts:14:'../payments/stripe/stripe.client'
test/support/create-test-app.ts:7:'../../src/payments/stripe/stripe.client'
src/authorization/ability.types.ts:22:'../auth/authenticated-user'
src/authorization/casl-ability.factory.spec.ts:3:'../auth/authenticated-user'
src/authorization/casl-ability.factory.ts:5:'../auth/authenticated-user'
src/authorization/guards/abilities.guard.spec.ts:9:'../../auth/authenticated-user'
src/authorization/registered-abilities.spec.ts:5:'../auth/authenticated-user'
src/cart/cart.controller.spec.ts:9:'../auth/authenticated-user'
src/cart/cart.controller.ts:14:'../auth/authenticated-user'
src/cart/cart.service.spec.ts:5:'../auth/authenticated-user'
src/cart/cart.service.ts:5:'../auth/authenticated-user'
src/orders/my-orders.controller.spec.ts:8:'../auth/authenticated-user'
src/orders/my-orders.controller.ts:3:'../auth/authenticated-user'
src/orders/orders.controller.spec.ts:9:'../auth/authenticated-user'
src/orders/orders.controller.ts:14:'../auth/authenticated-user'
src/orders/orders.service.spec.ts:13:'../auth/authenticated-user'
src/orders/orders.service.ts:16:'../auth/authenticated-user'
src/payments/methods/payment-intents.controller.ts:3:'../../auth/authenticated-user'
src/payments/methods/payment-links.controller.ts:3:'../../auth/authenticated-user'
src/payments/methods/payments.controllers.spec.ts:9:'../../auth/authenticated-user'
src/payments/methods/payments.service.spec.ts:10:'../../auth/authenticated-user'
src/payments/methods/payments.service.ts:11:'../../auth/authenticated-user'
src/products/products.controller.spec.ts:4:'../auth/authenticated-user'
src/products/products.controller.ts:15:'../auth/authenticated-user'
src/products/products.service.spec.ts:5:'../auth/authenticated-user'
src/products/products.service.ts:9:'../auth/authenticated-user'
src/skus/skus.controller.spec.ts:3:'../auth/authenticated-user'
src/skus/skus.controller.ts:4:'../auth/authenticated-user'
src/skus/skus.service.spec.ts:5:'../auth/authenticated-user'
src/skus/skus.service.ts:5:'../auth/authenticated-user'
test/support/validation-probe.module.ts:4:'../../src/auth/authenticated-user'
test/auth-notification-failure.e2e-spec.ts:5:'../src/auth/credentials/password.service'
test/auth-notification-failure.e2e-spec.ts:6:'../src/auth/credentials/secret-token.service'
test/auth.e2e-spec.ts:6:'../src/auth/credentials/password.service'
test/auth.e2e-spec.ts:7:'../src/auth/credentials/secret-token.service'
test/http-contract.e2e-spec.ts:7:'../src/auth/credentials/token.service'
```

## Docs that draw the layout

```text
README.md:73:src/auth/              login, JWTs, sessions, and password flows
README.md:74:src/products/          product reads and manager writes
README.md:75:src/skus/              product variants
README.md:76:src/images/            S3 image upload and assignments
README.md:77:src/cart/              client cart
README.md:78:src/orders/            snapshots, history, and status changes
README.md:79:src/payments/          methods/, webhook/, stripe/ — links, intents, settlement, SDK
README.md:326:mkdir -p src/payments/stripe
README.md:327:git mv src/payments/stripe.client.ts src/payments/stripe/stripe.client.ts
CLAUDE.md:138:  auth/            7 operations, JWT bound to a session row, Argon2id passwords
CLAUDE.md:140:  products/        catalogue reads plus manager writes
CLAUDE.md:141:  skus/            variants, money as decimal strings
CLAUDE.md:142:  images/          S3 upload, fallback vs. per-SKU assignment
CLAUDE.md:143:  cart/            client cart and current-price totals
CLAUDE.md:144:  orders/          order snapshots, history and status lifecycle
CLAUDE.md:145:  payments/        Stripe: methods/ links+intents · webhook/ settlement · stripe/ the SDK façade
```
