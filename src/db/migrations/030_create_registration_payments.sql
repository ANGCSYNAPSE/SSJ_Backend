-- The Shyam Jagat registration fee (Rs 501 or Rs 1100, the member's choice). One row per
-- Razorpay order, so a person who tries twice has two rows. A person has paid once any of
-- their rows is 'paid'; everyone else is "pending" for the admin's payment list.
CREATE TABLE IF NOT EXISTS registration_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                VARCHAR(20)    NOT NULL CHECK (plan IN ('basic', 'premium', 'manual')),
  amount_in_rupees    NUMERIC(12, 2) NOT NULL CHECK (amount_in_rupees > 0),
  status              VARCHAR(20)    NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  receipt             VARCHAR(80)    NOT NULL,
  razorpay_order_id   VARCHAR(255)   NOT NULL,
  razorpay_payment_id VARCHAR(255),
  failure_reason      TEXT,
  source              VARCHAR(20)    NOT NULL DEFAULT 'razorpay' CHECK (source IN ('razorpay', 'manual')),
  note                TEXT,
  recorded_by         UUID           REFERENCES users(id) ON DELETE SET NULL,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS registration_payments_order_unique ON registration_payments (razorpay_order_id);
CREATE INDEX IF NOT EXISTS registration_payments_user_idx ON registration_payments (user_id);
CREATE INDEX IF NOT EXISTS registration_payments_status_idx ON registration_payments (status, created_at DESC);

DROP TRIGGER IF EXISTS registration_payments_set_updated_at ON registration_payments;
CREATE TRIGGER registration_payments_set_updated_at
  BEFORE UPDATE ON registration_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
