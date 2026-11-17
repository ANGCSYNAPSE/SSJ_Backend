-- A signup that has been started but is not an account yet. Registration is: details -> email
-- code -> payment (at least the minimum) -> account created. Until then everything the person
-- typed waits here (the password already hashed, the profile as JSON), so a closed tab or a
-- failed card loses nothing and no half-made account exists.
CREATE TABLE IF NOT EXISTS pending_signups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name         VARCHAR(120)  NOT NULL,
  email             VARCHAR(255)  NOT NULL,
  mobile            VARCHAR(30)   NOT NULL,
  password_hash     TEXT          NOT NULL,
  become_member     BOOLEAN       NOT NULL DEFAULT FALSE,
  category          VARCHAR(20),
  profile           JSONB,
  otp_hash          VARCHAR(64),
  otp_expires_at    TIMESTAMPTZ,
  otp_attempts      INTEGER       NOT NULL DEFAULT 0,
  otp_sent_at       TIMESTAMPTZ,
  resend_count      INTEGER       NOT NULL DEFAULT 0,
  email_verified_at TIMESTAMPTZ,
  completed_user_id UUID          REFERENCES users(id) ON DELETE SET NULL,
  expires_at        TIMESTAMPTZ   NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pending_signups_email_idx ON pending_signups (lower(email));

DROP TRIGGER IF EXISTS pending_signups_set_updated_at ON pending_signups;
CREATE TRIGGER pending_signups_set_updated_at
  BEFORE UPDATE ON pending_signups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Payments made during signup belong to the pending signup until the account exists, then move to it.
ALTER TABLE registration_payments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE registration_payments ADD COLUMN IF NOT EXISTS pending_signup_id UUID REFERENCES pending_signups(id) ON DELETE SET NULL;
ALTER TABLE registration_payments DROP CONSTRAINT IF EXISTS registration_payments_owner_check;
ALTER TABLE registration_payments
  ADD CONSTRAINT registration_payments_owner_check CHECK (user_id IS NOT NULL OR pending_signup_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS registration_payments_pending_idx ON registration_payments (pending_signup_id);
