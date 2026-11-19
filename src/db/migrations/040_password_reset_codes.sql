-- Forgot password: a 6-digit code is emailed; entering it earns a one-time reset token (kept in password_resets).
-- One live code per person; only a hash of it is stored.
CREATE TABLE IF NOT EXISTS password_reset_codes (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash         VARCHAR(64)  NOT NULL,
  attempts          INTEGER      NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ  NOT NULL,
  sent_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  send_count        INTEGER      NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
