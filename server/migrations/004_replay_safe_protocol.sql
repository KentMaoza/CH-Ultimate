UPDATE devices
SET approved_at = created_at
WHERE approved_at IS NULL;

ALTER TABLE devices
  MODIFY approved_at TIMESTAMP(6) NOT NULL;

ALTER TABLE pairings
  ADD COLUMN IF NOT EXISTS request_id BINARY(16) NULL
    AFTER code_hash,
  ADD UNIQUE INDEX IF NOT EXISTS uq_pairings_request_id (request_id);
