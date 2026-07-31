ALTER TABLE imports
  ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(255) NULL AFTER workbook_sha256,
  ADD COLUMN IF NOT EXISTS preview_json JSON NULL AFTER status;

ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS source_import_id BINARY(16) NULL AFTER source_image_url,
  ADD COLUMN IF NOT EXISTS source_note TEXT NULL AFTER source_import_id,
  ADD COLUMN IF NOT EXISTS source_created_at TEXT NULL AFTER source_note,
  ADD INDEX IF NOT EXISTS idx_skus_source_import (source_import_id),
  ADD CONSTRAINT fk_skus_source_import
    FOREIGN KEY IF NOT EXISTS (source_import_id) REFERENCES imports (id);

CREATE TABLE IF NOT EXISTS image_assets (
  content_hash BINARY(32) NOT NULL PRIMARY KEY,
  mime_type VARCHAR(64) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  storage_path VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_image_assets_storage_path (storage_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS image_jobs (
  id BINARY(16) NOT NULL PRIMARY KEY,
  import_id BINARY(16) NOT NULL,
  sku_id BINARY(16) NOT NULL,
  source_url TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_error_code VARCHAR(96) NULL,
  content_hash BINARY(32) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_image_jobs_import_sku (import_id, sku_id),
  KEY idx_image_jobs_claim (status, next_attempt_at, created_at),
  KEY idx_image_jobs_content_hash (content_hash),
  CONSTRAINT fk_image_jobs_import
    FOREIGN KEY (import_id) REFERENCES imports (id) ON DELETE CASCADE,
  CONSTRAINT fk_image_jobs_sku
    FOREIGN KEY (sku_id) REFERENCES skus (id) ON DELETE CASCADE,
  CONSTRAINT fk_image_jobs_asset
    FOREIGN KEY (content_hash) REFERENCES image_assets (content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
