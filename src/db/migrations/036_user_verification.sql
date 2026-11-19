-- When and by whom an account was verified by an admin.
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE users SET verified_at = created_at WHERE is_verified = TRUE AND verified_at IS NULL;
CREATE INDEX IF NOT EXISTS users_is_verified_idx ON users (is_verified, created_at DESC);
