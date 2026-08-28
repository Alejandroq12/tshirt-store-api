# API implementation notes

Notes for starting development in NestJS. The contract is
[../api/openapi.yaml](../api/openapi.yaml), and the data model is
[db.dbml](db.dbml). This document only records what must be considered when
translating them into code.

## 1. Before writing the first line

### NestJS's default `ValidationPipe` breaks 24 of the 28 operations

NestJS returns `400` when validation fails. The contract documents `422` for
24 of the 28 operations. Without this configuration, almost the entire contract
is contradicted by the first request with an invalid payload.

```ts
app.useGlobalPipes(
  new ValidationPipe({
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
);
```

`forbidNonWhitelisted` is required: 36 schemas declare
`additionalProperties: false`, and 9 declare
`unevaluatedProperties: false`. If a DTO accepts unknown fields, the
implementation is more permissive than the contract.

### `constraints.sql` is applied as a migration

Prisma does not support CHECK constraints, partial indexes, or triggers. They
therefore live in the constraints migration,
[`prisma/migrations/20260828002527_constraints/migration.sql`](../prisma/migrations/20260828002527_constraints/migration.sql),
rather than the Prisma schema:

| Object                                     | Count |
| ------------------------------------------ | ----- |
| CHECK constraints                          | 18    |
| Indexes (3 partial unique, 4 supporting)   | 7     |
| Triggers                                   | 1     |

The directory timestamps guarantee the order: `..._init` first, followed by
`..._constraints`. `prisma migrate deploy` applies them in that order.

### Composite foreign keys in Prisma

`sku_image_assignments` and `order_items` use composite foreign keys. Prisma
supports them through `fields: [...]` and `references: [...]`, but it requires
a unique index on the referenced side. The required indexes already exist:
`uq_sku_parent` and `uq_product_image_parent`, both on `(product_id, id)`.
Do not remove them from the schema.

## 2. What the database already guarantees

Do not reimplement these rules in application code. PostgreSQL raises an error
when one is violated; the application must translate that error into the `409`
or `422` documented by the contract.

| Rule                                                        | Enforced by                                              |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| Only one `PENDING` order per client                       | `uq_one_pending_order`                                 |
| `sku_code` is unique across the store                     | `uq_skus_code`                                         |
| Only one size-and-color combination per product             | `uq_sku_variant`                                       |
| One low-stock email per client, product, and cycle          | `uq_stock_notice_cycle`                                |
| One item per SKU in a cart                                  | `uq_cart_sku`                                          |
| One line per SKU in an order                                | `uq_order_sku`                                         |
| One primary product image and one primary image per SKU     | `uq_one_product_primary_image`, `uq_one_sku_primary_image` |
| Stock is never negative                                     | `chk_skus_stock`                                       |
| `low_stock_cycle` is never negative                       | `chk_products_low_stock_cycle`, `chk_stock_notice_cycle` |
| A retired product cannot be active                          | `chk_products_retired_inactive`                        |
| `line_total = unit_price * quantity`                      | `chk_order_items_line`                                 |
| `paid_at` is consistent with the order status             | `chk_orders_paid_at`                                   |
| Products cannot be physically deleted                       | `trg_products_prevent_hard_delete`                     |

The contract has nine operations that document `409`. Each corresponds to one
of these constraints or an invalid state transition.

## 3. What only the application code guarantees

The database cannot prevent the following errors. This is where bugs are most
likely, so the list also serves as the unit-test checklist for week 3.

| # | Rule | Failure if omitted |
| - | ---- | ------------------ |
| 1 | Increment `products.low_stock_cycle` when total stock rises above 3 again | The system behaves as if cycles did not exist: one email per client, never another |
| 2 | Detect the downward threshold crossing (`> 3` → `<= 3`), not merely the current level | `if (stock === 3)` misses 5 → 2, while remaining at 2 queues repeated emails |
| 3 | Acquire locks in a stable order: product first, then its SKUs by ascending ID | Deadlocks under concurrency (SQLSTATE 40P01) |
| 4 | Decrement stock atomically | A partial decrement leaves inventory and the order inconsistent |
| 5 | Reconcile the cart by subtracting the purchased quantity rather than deleting the row | A cart that grew from 2 to 5 loses the 3 units the client still wanted |
| 6 | Reprocess `stripe_webhook_events WHERE processed_at IS NULL` with `FOR UPDATE SKIP LOCKED` | A payment with insufficient stock leaves the order `pending` forever; Stripe already received the 204 and does not retry |
| 7 | Revoke every session when a password is changed or reset | Old sessions remain active after a security event |
| 8 | Reject activation of a product without a usable primary image | The low-stock email has no image to include |
| 9 | Match a Payment Link buyer through the email on the Stripe session | Without a client there can be no order: `orders.client_id` is NOT NULL |

Minimum test for rules 1 and 2, which are the easiest to break:

```
stock 5 → 2   notify and record cycle 0
stock 2 → 1   DO NOT notify (still below the threshold)
stock 1 → 8   increment low_stock_cycle to 1
stock 8 → 3   notify the same client again, cycle 1
```

## 4. Contract guardrail

To prevent the YAML contract from degrading during development:

```json
"lint:api": "redocly lint api/openapi.yaml"
```

Status when the design was delivered: valid, 0 errors, 1 warning
(`info-license`, intentionally ignored).

## 5. Decisions to confirm with Erick during implementation

None blocks initial development, but each is my interpretation rather than an
instruction from Erick:

- **"Delete products" as a soft deletion.** `PATCH /products/{id}` with
  `status: retired`, without `DELETE`. He considered it reasonable in the
  meeting but did not confirm it as the final interpretation.
- **The `active`, `inactive`, and `retired` statuses.** Only `inactive`
  maps directly to a requirement ("Disable products").
- **`retired` is permanent and cannot be reactivated.**
- **The per-SKU image model.** He asked for image selection by variant; the
  concrete design (`sku_image_assignments` as many-to-many with fallback) is
  mine.
- **`GET /manager/products` as the unnecessary endpoint.** He said one
  endpoint was unnecessary but never identified it. I removed this one based
  on my own traceability assessment, not because he named it.
- **Stripe.** The model still marks its identifiers as BLUEPRINT pending the
  workshop, while the contract already describes the complete flow. Align them
  after the workshop.

## 6. Where each rule is documented

| Looking for                                           | File                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes, schemas, status codes, and examples           | [openapi.yaml](../api/openapi.yaml)                                                                                                         |
| Tables, columns, relationships, and indexes           | [db.dbml](db.dbml)                                                                                                                          |
| CHECK constraints, partial indexes, and trigger       | [`prisma/migrations/20260828002527_constraints/migration.sql`](../prisma/migrations/20260828002527_constraints/migration.sql)             |
| States, deletion, stock, sessions, and notifications  | [data-lifecycle.md](data-lifecycle.md)                                                                                                      |
| Internal flows, locks, queue, and monitoring          | [architecture.md](architecture.md)                                                                                                          |
| Decisions made here rather than stated in a requirement | Section 5 of this file                                                                                                                       |
