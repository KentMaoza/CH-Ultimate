CREATE TABLE IF NOT EXISTS schema_migrations (
  version BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  checksum BINARY(32) NOT NULL,
  applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS devices (
  id BINARY(16) NOT NULL PRIMARY KEY,
  display_name VARCHAR(160) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  token_hash BINARY(32) NOT NULL,
  token_expires_at TIMESTAMP(6) NOT NULL,
  previous_token_hash BINARY(32) NULL,
  previous_token_expires_at TIMESTAMP(6) NULL,
  approved_at TIMESTAMP(6) NULL,
  revoked_at TIMESTAMP(6) NULL,
  last_seen_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_devices_token_hash (token_hash),
  KEY idx_devices_previous_token_hash (previous_token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pairings (
  id BINARY(16) NOT NULL PRIMARY KEY,
  code_hash BINARY(32) NOT NULL,
  requested_display_name VARCHAR(160) NOT NULL,
  requested_platform VARCHAR(32) NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  redeemed_at TIMESTAMP(6) NULL,
  approved_at TIMESTAMP(6) NULL,
  approved_by_device_id BINARY(16) NULL,
  paired_device_id BINARY(16) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_pairings_code_hash (code_hash),
  CONSTRAINT fk_pairings_approved_by_device
    FOREIGN KEY (approved_by_device_id) REFERENCES devices (id),
  CONSTRAINT fk_pairings_paired_device
    FOREIGN KEY (paired_device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS owner_recovery (
  singleton_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  credential_hash BINARY(32) NOT NULL,
  credential_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  rotated_at TIMESTAMP(6) NULL,
  CHECK (singleton_id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS skus (
  id BINARY(16) NOT NULL PRIMARY KEY,
  primary_identifier TEXT NOT NULL,
  name VARCHAR(512) NOT NULL,
  price_rupiah BIGINT UNSIGNED NOT NULL,
  image_hash BINARY(32) NULL,
  source_image_url TEXT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  archived_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sku_identifiers (
  id BINARY(16) NOT NULL PRIMARY KEY,
  sku_id BINARY(16) NOT NULL,
  identifier_value TEXT NOT NULL,
  identifier_hash BINARY(32) NOT NULL,
  identifier_kind VARCHAR(32) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_sku_identifiers_hash (identifier_hash),
  KEY idx_sku_identifiers_sku (sku_id),
  CONSTRAINT fk_sku_identifiers_sku
    FOREIGN KEY (sku_id) REFERENCES skus (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_history (
  id BINARY(16) NOT NULL PRIMARY KEY,
  sku_id BINARY(16) NOT NULL,
  price_rupiah BIGINT UNSIGNED NOT NULL,
  source VARCHAR(64) NOT NULL,
  changed_by_device_id BINARY(16) NULL,
  effective_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_price_history_sku_effective (sku_id, effective_at),
  CONSTRAINT fk_price_history_sku
    FOREIGN KEY (sku_id) REFERENCES skus (id),
  CONSTRAINT fk_price_history_device
    FOREIGN KEY (changed_by_device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notas (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nota_number VARCHAR(40) NOT NULL,
  business_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL,
  header_json JSON NOT NULL,
  field_versions JSON NOT NULL,
  structure_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  lifecycle_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  subtotal_rupiah BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_rupiah BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_by_device_id BINARY(16) NOT NULL,
  completed_at TIMESTAMP(6) NULL,
  cancelled_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_notas_number (nota_number),
  KEY idx_notas_business_date (business_date),
  CONSTRAINT fk_notas_created_by_device
    FOREIGN KEY (created_by_device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nota_pages (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nota_id BINARY(16) NOT NULL,
  page_position INT UNSIGNED NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_nota_pages_position (nota_id, page_position),
  UNIQUE KEY uq_nota_pages_id_nota (id, nota_id),
  CONSTRAINT fk_nota_pages_nota
    FOREIGN KEY (nota_id) REFERENCES notas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nota_lines (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nota_id BINARY(16) NOT NULL,
  page_id BINARY(16) NOT NULL,
  sku_id BINARY(16) NULL,
  line_position INT UNSIGNED NOT NULL,
  sku_identifier_snapshot TEXT NOT NULL,
  sku_name_snapshot VARCHAR(512) NOT NULL,
  quantity_pcs BIGINT NOT NULL,
  unit_price_rupiah BIGINT UNSIGNED NOT NULL,
  line_total_rupiah BIGINT NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_nota_lines_position (page_id, line_position),
  KEY idx_nota_lines_nota (nota_id),
  CONSTRAINT fk_nota_lines_page_nota
    FOREIGN KEY (page_id, nota_id) REFERENCES nota_pages (id, nota_id),
  CONSTRAINT fk_nota_lines_sku
    FOREIGN KEY (sku_id) REFERENCES skus (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nota_postings (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nota_id BINARY(16) NOT NULL,
  posting_kind VARCHAR(32) NOT NULL,
  amount_rupiah BIGINT NOT NULL DEFAULT 0,
  reverses_posting_id BINARY(16) NULL,
  posted_by_device_id BINARY(16) NOT NULL,
  posted_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_nota_postings_nota (nota_id, posted_at),
  CONSTRAINT fk_nota_postings_nota
    FOREIGN KEY (nota_id) REFERENCES notas (id),
  CONSTRAINT fk_nota_postings_reversal
    FOREIGN KEY (reverses_posting_id) REFERENCES nota_postings (id),
  CONSTRAINT fk_nota_postings_device
    FOREIGN KEY (posted_by_device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  id BINARY(16) NOT NULL PRIMARY KEY,
  sku_id BINARY(16) NOT NULL,
  delta_pcs BIGINT NOT NULL,
  reason VARCHAR(160) NOT NULL,
  nota_posting_id BINARY(16) NULL,
  device_id BINARY(16) NOT NULL,
  operation_id BINARY(16) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_stock_movements_sku_created (sku_id, created_at),
  KEY idx_stock_movements_operation (operation_id),
  CONSTRAINT fk_stock_movements_sku
    FOREIGN KEY (sku_id) REFERENCES skus (id),
  CONSTRAINT fk_stock_movements_nota_posting
    FOREIGN KEY (nota_posting_id) REFERENCES nota_postings (id),
  CONSTRAINT fk_stock_movements_device
    FOREIGN KEY (device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_balances (
  sku_id BINARY(16) NOT NULL PRIMARY KEY,
  quantity_pcs BIGINT NOT NULL DEFAULT 0,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_stock_balances_sku
    FOREIGN KEY (sku_id) REFERENCES skus (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS templates (
  id BINARY(16) NOT NULL PRIMARY KEY,
  template_kind VARCHAR(32) NOT NULL,
  name VARCHAR(160) NOT NULL,
  definition_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  archived_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS imports (
  id BINARY(16) NOT NULL PRIMARY KEY,
  workbook_sha256 BINARY(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  staged_path TEXT NULL,
  result_json JSON NULL,
  created_by_device_id BINARY(16) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at TIMESTAMP(6) NULL,
  committed_at TIMESTAMP(6) NULL,
  UNIQUE KEY uq_imports_workbook_sha256 (workbook_sha256),
  CONSTRAINT fk_imports_device
    FOREIGN KEY (created_by_device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS idempotency_receipts (
  device_id BINARY(16) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  payload_hash BINARY(32) NOT NULL,
  response_status SMALLINT UNSIGNED NOT NULL,
  response_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at TIMESTAMP(6) NOT NULL,
  PRIMARY KEY (device_id, idempotency_key),
  KEY idx_idempotency_receipts_expiry (expires_at),
  CONSTRAINT fk_idempotency_receipts_device
    FOREIGN KEY (device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_events (
  id BINARY(16) NOT NULL PRIMARY KEY,
  device_id BINARY(16) NULL,
  action VARCHAR(96) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BINARY(16) NULL,
  detail_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_audit_events_entity (entity_type, entity_id, created_at),
  CONSTRAINT fk_audit_events_device
    FOREIGN KEY (device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_cursor_acknowledgements (
  device_id BINARY(16) NOT NULL PRIMARY KEY,
  change_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  acknowledged_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_client_cursor_acknowledgements_device
    FOREIGN KEY (device_id) REFERENCES devices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS change_log (
  sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BINARY(16) NOT NULL,
  operation VARCHAR(32) NOT NULL,
  payload_json JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_change_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
