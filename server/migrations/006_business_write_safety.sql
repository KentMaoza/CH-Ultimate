CREATE TABLE IF NOT EXISTS business_write_lock (
  singleton_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  CONSTRAINT chk_business_write_lock_singleton
    CHECK (singleton_id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO business_write_lock (singleton_id) VALUES (1);

ALTER TABLE image_jobs
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP(6) NULL AFTER attempt_count,
  ADD INDEX IF NOT EXISTS idx_image_jobs_lease
    (status, next_attempt_at, claimed_at, created_at);
