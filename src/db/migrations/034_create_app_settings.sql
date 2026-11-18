-- Small settings an admin can change without a deploy (for now: the registration fee). One row per
-- setting; the value is JSON so a setting can hold more than one number.
CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(60) PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
