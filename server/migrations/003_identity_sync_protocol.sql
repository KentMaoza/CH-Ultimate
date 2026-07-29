ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'client' AFTER id,
  ADD COLUMN IF NOT EXISTS installation_id BINARY(16) NULL AFTER role,
  ADD COLUMN IF NOT EXISTS active_owner_slot TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN role = 'owner' AND revoked_at IS NULL THEN 1 ELSE NULL END
    ) PERSISTENT,
  ADD UNIQUE INDEX IF NOT EXISTS uq_devices_active_owner (active_owner_slot);

UPDATE devices
SET installation_id = UNHEX(REPLACE(UUID(), '-', ''))
WHERE installation_id IS NULL;

ALTER TABLE devices
  MODIFY installation_id BINARY(16) NOT NULL,
  ADD UNIQUE INDEX IF NOT EXISTS uq_devices_installation (installation_id);

ALTER TABLE devices
  ADD CONSTRAINT IF NOT EXISTS chk_devices_role
  CHECK (role IN ('owner', 'client'));

ALTER TABLE pairings
  MODIFY requested_display_name VARCHAR(160) NULL,
  MODIFY requested_platform VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS requested_installation_id BINARY(16) NULL
    AFTER code_hash,
  ADD COLUMN IF NOT EXISTS claim_hash BINARY(32) NULL
    AFTER requested_installation_id,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP(6) NULL
    AFTER paired_device_id,
  ADD UNIQUE INDEX IF NOT EXISTS uq_pairings_claim_hash (claim_hash),
  ADD INDEX IF NOT EXISTS idx_pairings_installation (requested_installation_id);
