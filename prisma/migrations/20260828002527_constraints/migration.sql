-- Database CHECK constraints, delete guards, and PostgreSQL indexes.

-- ============================================================================
--  1. CHECK CONSTRAINTS
-- ============================================================================

-- ---------------------------------------------------------------- users ----

ALTER TABLE users ADD CONSTRAINT chk_users_email_lower
  CHECK (email = lower(email));

-- --------------------------------------------------------- product_skus ----

ALTER TABLE product_skus ADD CONSTRAINT chk_skus_price
  CHECK (price > 0);

-- Prevent stock from becoming negative.
ALTER TABLE product_skus ADD CONSTRAINT chk_skus_stock
  CHECK (stock_quantity >= 0);

-- ------------------------------------------------------------- products ----

ALTER TABLE products ADD CONSTRAINT chk_products_retired_inactive
  CHECK (deleted_at IS NULL OR NOT is_active);

ALTER TABLE products ADD CONSTRAINT chk_products_low_stock_cycle
  CHECK (low_stock_cycle >= 0);

-- ------------------------------------------------------- product_images ----

ALTER TABLE product_images ADD CONSTRAINT chk_images_primary_scope
  CHECK (NOT is_product_primary OR is_fallback);

-- ----------------------------------------------------------- cart_items ----

ALTER TABLE cart_items ADD CONSTRAINT chk_cart_quantity
  CHECK (quantity > 0);

-- --------------------------------------------------------------- orders ----

ALTER TABLE orders ADD CONSTRAINT chk_orders_total_positive
  CHECK (total_amount > 0);

ALTER TABLE orders ADD CONSTRAINT chk_orders_paid_at
  CHECK ((status = 'PENDING' AND paid_at IS NULL)
         OR status = 'CANCELLED'
         OR (status IN ('PAID', 'PROCESSING', 'SHIPPED') AND paid_at IS NOT NULL));

ALTER TABLE orders ADD CONSTRAINT chk_orders_cancelled_at
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));

ALTER TABLE orders ADD CONSTRAINT chk_orders_payment_link_reference
  CHECK ((payment_method = 'PAYMENT_LINK') = (payment_link_id IS NOT NULL));

-- BLUEPRINT: a paid order must have only the Stripe ID that matches its payment method.
ALTER TABLE orders ADD CONSTRAINT chk_orders_stripe_id
  CHECK (
    paid_at IS NULL
    OR (payment_method = 'PAYMENT_LINK'
        AND stripe_checkout_session_id IS NOT NULL
        AND stripe_payment_intent_id IS NULL)
    OR (payment_method = 'PAYMENT_INTENT'
        AND stripe_payment_intent_id IS NOT NULL
        AND stripe_checkout_session_id IS NULL)
  );

-- ---------------------------------------------------------- order_items ----

ALTER TABLE order_items ADD CONSTRAINT chk_order_items_quantity
  CHECK (quantity > 0);

ALTER TABLE order_items ADD CONSTRAINT chk_order_items_price
  CHECK (unit_price > 0);

ALTER TABLE order_items ADD CONSTRAINT chk_order_items_line
  CHECK (line_total = unit_price * quantity);

-- -------------------------------------------------------- payment_links ----

ALTER TABLE payment_links ADD CONSTRAINT chk_payment_links_quantity
  CHECK (quantity > 0);

-- -------------------------------------------------- stock_notifications ----

ALTER TABLE stock_notifications ADD CONSTRAINT chk_stock_notice_amount
  CHECK (stock_at_send >= 0);

ALTER TABLE stock_notifications ADD CONSTRAINT chk_stock_notice_cycle
  CHECK (low_stock_cycle >= 0);

-- ============================================================================
--  2. DELETE GUARDS
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_product_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Products cannot be physically deleted; set deleted_at to retire the product.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER trg_products_prevent_hard_delete
  BEFORE DELETE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_product_hard_delete();

-- ============================================================================
--  3. PARTIAL INDEXES
-- ============================================================================
--  Unique partial indexes.
-- ============================================================================

CREATE UNIQUE INDEX uq_one_product_primary_image
  ON product_images (product_id) WHERE is_fallback AND is_product_primary;

CREATE UNIQUE INDEX uq_one_sku_primary_image
  ON sku_image_assignments (sku_id) WHERE is_primary;


CREATE UNIQUE INDEX uq_one_pending_order
  ON orders (client_id) WHERE status = 'PENDING';

-- ------------------------------------------------------ non-unique ---------

CREATE INDEX idx_sessions_live
  ON sessions (user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_products_live
  ON products (created_at DESC) WHERE deleted_at IS NULL AND is_active;

CREATE INDEX idx_skus_purchasable
  ON product_skus (product_id, price)
  WHERE stock_quantity > 0;

CREATE INDEX idx_webhook_pending
  ON stripe_webhook_events (created_at)
  WHERE processed_at IS NULL;
