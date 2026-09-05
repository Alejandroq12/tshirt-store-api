ALTER TABLE stock_notifications
  ALTER COLUMN stock_at_send DROP NOT NULL,
  ALTER COLUMN sent_at DROP NOT NULL,
  ALTER COLUMN sent_at DROP DEFAULT;

CREATE INDEX idx_stock_notice_pending
  ON stock_notifications (id)
  WHERE sent_at IS NULL;
