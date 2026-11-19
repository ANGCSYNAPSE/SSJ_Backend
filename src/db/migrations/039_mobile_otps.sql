-- One live phone-verification code per person (a new request replaces the old one). Only a hash of the code is stored.
CREATE TABLE IF NOT EXISTS mobile_otps (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mobile            VARCHAR(30)  NOT NULL,
  code_hash         VARCHAR(64)  NOT NULL,
  attempts          INTEGER      NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ  NOT NULL,
  sent_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  send_count        INTEGER      NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
