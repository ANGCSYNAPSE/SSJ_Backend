-- Sign in with Google: Google's stable account id ("sub") is remembered on the account, and on an unfinished signup
-- until its account is created.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON users (google_sub) WHERE google_sub IS NOT NULL;
ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64);
