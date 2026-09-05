# Data lifecycle and relationship rules

The consumer contract is [openapi.yaml](../api/openapi.yaml). This file records
only the storage-facing rules that affect it.

## Products and SKUs

- Products expose exactly three states: `active`, `inactive`, and `retired`.
- `inactive` is temporary and may return to `active`.
- `retired` is permanent, but the product remains stored.
- Products are never physically deleted. Retirement is requested through
  `PATCH /products/{productId}`.
- Activating a product requires a usable product fallback primary image. A
  product without one stays inactive, so the low-stock email always has an
  image to include.
- Retirement is terminal for the status. Name, description, and category stay
  editable after retirement.

| API status | Stored values |
|---|---|
| `active` | `is_active=true`, `deleted_at=null` |
| `inactive` | `is_active=false`, `deleted_at=null` |
| `retired` | `is_active=false`, `deleted_at=<retirement timestamp>` |

The always-returned API field `retiredAt` is the stored `deleted_at` value, or
null for active/inactive products.

- A SKU has no lifecycle state of its own. It is purchasable while its product
  is `active` and its stock is above zero. The contract permits field updates
  through `PATCH /skus/{skuId}` and exposes no SKU status or DELETE operation.
- `sku_code` is supplied by a manager and is unique across the store
  (`uq_skus_code`). One product cannot repeat a size and color pair
  (`uq_sku_variant`). A retired product keeps its codes, so they are never
  reused.

## Images

- Every image asset is owned by one product and stores one S3 object.
- An image with `is_fallback=true` has no `sku_image_assignments` and is a
  general product fallback. The upload transaction creates either that scope
  or a non-fallback asset with one or more assignments, never both.
- `sku_image_assignments` is a many-to-many relationship: one image may serve
  several SKUs, and one SKU may use several images.
- Composite foreign keys require the image and SKU in an assignment to belong
  to the same product.
- There is at most one product fallback primary and at most one primary image
  per SKU.
- The contract creates image associations during upload. It does not expose
  image deletion, reordering, or later reassignment operations.
- Uploads accept `image/jpeg`, `image/png`, and `image/webp` up to 5 MB, and
  the stored URL is permanent and public, because product images are readable
  by anonymous visitors.
- `images: []` and a null primary can only appear on an `inactive` or `retired`
  product, because activation requires a usable fallback primary.

## Likes

A like is a per-client product state. Internally, the
`(client_id, product_id)` row exists for `liked: true` and is absent for
`liked: false`. The API changes both states with one idempotent PATCH
operation; it does not expose a DELETE unlike operation.

## Orders, carts, and stock

- Orders and order items are never deleted.
- Order items retain product, SKU, quantity, and price snapshots.
- Cart items are real mutable resources and may be deleted.
- A client has at most one `pending` order (`uq_one_pending_order`). A second
  `POST /orders` before paying or cancelling the first returns 409.
- Stock is decremented when a payment webhook marks an order paid, never when
  an item is added to a cart or when a pending order is created. The cart
  therefore reserves nothing.
- Successful-payment processing locks affected Products and SKUs in stable ID
  order and validates every frozen order line. Stock is decremented in full for
  every line or not at all. The paid status, stock changes, cart reconciliation,
  stock-cycle evaluation, and processed-event marker commit in one transaction.
  An insufficient line leaves all those values unchanged and the event stored
  as unprocessed with its error; partial stock deductions are forbidden.
- A 204 webhook response acknowledges durable event receipt, not completed
  business processing. A scheduled producer enqueues stored events with
  `processed_at IS NULL`; reconciliation workers claim them without overlap and
  rerun the same idempotent handler until processing succeeds.
- For a Payment Intent, cart reconciliation subtracts the frozen order quantity
  from the current cart quantity for each SKU. A positive remainder is kept,
  a zero-or-negative remainder deletes the row, and a missing row is ignored.
  Thus the webhook never removes more than the paid quantity. Payment Link
  purchases do not alter a cart.
- Cancelling a paid order returns its items' quantities to stock. The money is
  refunded through Stripe outside this API and no field represents it.

## Sessions and passwords

- A session row is created at sign-up or sign-in and revoked, never deleted.
- The refresh token is not rotated; refreshing issues a new access token only.
- A password change or a password reset revokes every session belonging to that
  user, including the caller's own session on a change.

## Low-stock notifications

- Webhook decrements, paid-order cancellation restorations, and SKU stock
  updates are serialized per Product by locking its Product row before its SKU
  rows. Low stock is the aggregate SKU stock crossing from `> 3` to `<= 3`;
  this includes jumps such as 5 to 2. Staying at or below 3 does not trigger
  another notification.
- A client is in the audience when they like the product and have no order line
  for any of its SKUs in an order that is paid and not cancelled. A
  paid-then-cancelled order therefore does not count as a purchase.
- `products.low_stock_cycle` increments exactly once when aggregate stock
  crosses from `<= 3` to `> 3`. Staying above 3 does not increment it.
  `uq_stock_notice_cycle` allows one email per client, product, and cycle, so a
  client is warned once per low-stock event and a restock is what makes a later
  email possible.
- A crossing creates a pending `stock_notifications` row in the stock mutation
  transaction. BullMQ receives only that row's id after commit. The worker
  reloads the current email address and fallback image, sends the email, and
  then records `stock_at_send` and `sent_at`.
