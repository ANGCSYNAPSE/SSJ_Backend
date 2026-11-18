-- 1. Signup codes live in their own table. A code exists only until it is used or expires: once it is
--    verified, the fact is kept on the pending signup (email_verified_at) and the code row is deleted.
CREATE TABLE IF NOT EXISTS otp_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_signup_id UUID        NOT NULL REFERENCES pending_signups(id) ON DELETE CASCADE,
  channel           VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms', 'both')),
  code_hash         VARCHAR(64) NOT NULL,
  attempts          INTEGER     NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS otp_codes_pending_idx ON otp_codes (pending_signup_id);
CREATE INDEX IF NOT EXISTS otp_codes_expires_idx ON otp_codes (expires_at);

-- 2. A pending signup remembers when the person finished the details step (the artist / temple form,
--    or a member's city and state). The payment step only opens after it.
ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS details_saved_at TIMESTAMPTZ;

-- 3. Refresh tokens are stored (only as a hash) so a session can be ended on the server: logout,
--    a password reset, a blocked account, or a token being used twice (which means it was copied).
--    Each refresh replaces the token with a new one and marks the old one revoked.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           UUID PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   VARCHAR(64)  NOT NULL,
  remember     BOOLEAN      NOT NULL DEFAULT TRUE,
  expires_at   TIMESTAMPTZ  NOT NULL,
  revoked_at   TIMESTAMPTZ,
  replaced_by  UUID,
  user_agent   VARCHAR(255),
  ip           VARCHAR(64),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_idx ON refresh_tokens (expires_at);
