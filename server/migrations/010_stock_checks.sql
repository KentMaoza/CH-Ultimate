ALTER TABLE stock_balances
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP(6) NULL;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS balance_row_version_after BIGINT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS stock_checks (
  id BINARY(16) NOT NULL PRIMARY KEY,
  sku_id BINARY(16) NOT NULL,
  observed_quantity_pcs BIGINT NOT NULL,
  counted_quantity_pcs BIGINT NOT NULL,
  server_quantity_before_pcs BIGINT NOT NULL,
  applied_delta_pcs BIGINT NOT NULL,
  base_balance_version BIGINT UNSIGNED NULL,
  balance_row_version_after BIGINT UNSIGNED NOT NULL,
  forced_offline BOOLEAN NOT NULL DEFAULT FALSE,
  counted_at TIMESTAMP(6) NOT NULL,
  applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  device_id BINARY(16) NOT NULL,
  device_display_name VARCHAR(160) NOT NULL,
  operation_id BINARY(16) NOT NULL,
  note VARCHAR(512) NULL,
  UNIQUE KEY uq_stock_checks_device_operation (device_id, operation_id),
  KEY idx_stock_checks_sku_counted (sku_id, counted_at, id),
  KEY idx_stock_checks_applied (applied_at, id),
  CONSTRAINT fk_stock_checks_sku
    FOREIGN KEY (sku_id) REFERENCES skus (id),
  CONSTRAINT fk_stock_checks_device
    FOREIGN KEY (device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO stock_balances
  (sku_id, quantity_pcs, row_version)
SELECT skus.id, 0, 1
FROM skus
LEFT JOIN stock_balances ON stock_balances.sku_id = skus.id
WHERE skus.archived_at IS NULL
  AND stock_balances.sku_id IS NULL;
