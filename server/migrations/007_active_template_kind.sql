ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS active_template_kind VARCHAR(32)
    GENERATED ALWAYS AS (
      CASE WHEN archived_at IS NULL THEN template_kind ELSE NULL END
    ) STORED;

ALTER TABLE templates
  ADD UNIQUE INDEX IF NOT EXISTS uq_templates_active_kind
    (active_template_kind);
