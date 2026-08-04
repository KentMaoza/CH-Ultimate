CREATE TABLE IF NOT EXISTS nota_daily_sequences (
  business_date DATE NOT NULL PRIMARY KEY,
  next_sequence INT UNSIGNED NOT NULL,
  CONSTRAINT chk_nota_daily_sequence
    CHECK (next_sequence BETWEEN 1 AND 9999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE nota_pages
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active'
    AFTER page_position,
  ADD COLUMN IF NOT EXISTS lifecycle_version BIGINT UNSIGNED NOT NULL DEFAULT 1
    AFTER row_version;

ALTER TABLE nota_lines
  ADD COLUMN IF NOT EXISTS kind_snapshot VARCHAR(160) NOT NULL DEFAULT ''
    AFTER sku_name_snapshot,
  ADD COLUMN IF NOT EXISTS unit_kind VARCHAR(8) NOT NULL DEFAULT 'pcs'
    AFTER quantity_pcs,
  ADD COLUMN IF NOT EXISTS pcs_price_rupiah BIGINT UNSIGNED NOT NULL DEFAULT 0
    AFTER unit_price_rupiah,
  ADD COLUMN IF NOT EXISTS lsn_price_rupiah BIGINT UNSIGNED NOT NULL DEFAULT 0
    AFTER pcs_price_rupiah;

ALTER TABLE notas
  ADD COLUMN IF NOT EXISTS completion_destination VARCHAR(32) NULL
    AFTER status,
  ADD COLUMN IF NOT EXISTS cancelled_from_status VARCHAR(32) NULL
    AFTER completion_destination;

ALTER TABLE nota_postings
  ADD COLUMN IF NOT EXISTS snapshot_json JSON NULL
    AFTER amount_rupiah,
  ADD COLUMN IF NOT EXISTS lifecycle_version BIGINT UNSIGNED NOT NULL DEFAULT 1
    AFTER snapshot_json,
  ADD UNIQUE INDEX IF NOT EXISTS uq_nota_posting_lifecycle
    (nota_id, lifecycle_version, posting_kind);

CREATE TABLE IF NOT EXISTS revenue_postings (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nota_id BINARY(16) NOT NULL,
  nota_posting_id BINARY(16) NOT NULL,
  amount_rupiah BIGINT NOT NULL,
  posting_kind VARCHAR(32) NOT NULL,
  posted_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_revenue_postings_nota (nota_id, posted_at),
  CONSTRAINT fk_revenue_postings_nota
    FOREIGN KEY (nota_id) REFERENCES notas (id),
  CONSTRAINT fk_revenue_postings_posting
    FOREIGN KEY (nota_posting_id) REFERENCES nota_postings (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nota_conflicts (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nota_id BINARY(16) NOT NULL,
  device_id BINARY(16) NOT NULL,
  original_operation_id BINARY(16) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BINARY(16) NOT NULL,
  field_name VARCHAR(64) NULL,
  base_json JSON NOT NULL,
  mine_json JSON NOT NULL,
  server_json JSON NOT NULL,
  intent_json JSON NOT NULL,
  resolved_choice VARCHAR(16) NULL,
  resolved_by_device_id BINARY(16) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  resolved_at TIMESTAMP(6) NULL,
  UNIQUE KEY uq_nota_conflict_operation (device_id, original_operation_id),
  KEY idx_nota_conflicts_nota (nota_id, resolved_at),
  CONSTRAINT fk_nota_conflicts_nota
    FOREIGN KEY (nota_id) REFERENCES notas (id),
  CONSTRAINT fk_nota_conflicts_device
    FOREIGN KEY (device_id) REFERENCES devices (id),
  CONSTRAINT fk_nota_conflicts_resolver
    FOREIGN KEY (resolved_by_device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
