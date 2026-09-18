DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'donation_status') THEN
    CREATE TYPE donation_status AS ENUM ('created', 'paid', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS donations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_in_rupees    NUMERIC(12, 2)  NOT NULL,
  cause               VARCHAR(255)    NOT NULL,
  donor_name          VARCHAR(255)    NOT NULL,
  email               VARCHAR(255),
  phone               VARCHAR(30),
  anonymous           BOOLEAN         NOT NULL DEFAULT FALSE,
  want_receipt        BOOLEAN         NOT NULL DEFAULT TRUE,
  razorpay_order_id   VARCHAR(255)    NOT NULL,
  razorpay_payment_id VARCHAR(255),
  status              donation_status NOT NULL DEFAULT 'created',
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS donations_razorpay_order_id_unique ON donations (razorpay_order_id);
CREATE INDEX IF NOT EXISTS donations_status_idx ON donations (status);

DROP TRIGGER IF EXISTS donations_set_updated_at ON donations;
CREATE TRIGGER donations_set_updated_at
  BEFORE UPDATE ON donations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
