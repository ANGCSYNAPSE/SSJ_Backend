-- One-time password reset tokens. Only a SHA-256 hash of the token is stored,
-- so a database leak cannot be used to reset anyone's password.
CREATE TABLE IF NOT EXISTS password_resets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash CHAR(64)    NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS password_resets_token_hash_unique ON password_resets (token_hash);
CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id);
