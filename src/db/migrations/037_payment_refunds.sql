-- Refunds of registration-fee payments. A payment keeps its row; what has gone back is tracked beside it.
ALTER TABLE registration_payments ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- What the payment is still worth after refunds: this is what counts towards a person's fee.
ALTER TABLE registration_payments
  ADD COLUMN IF NOT EXISTS net_amount_in_rupees NUMERIC(12, 2) GENERATED ALWAYS AS (amount_in_rupees - refunded_amount) STORED;

CREATE TABLE IF NOT EXISTS payment_refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         UUID           NOT NULL REFERENCES registration_payments(id) ON DELETE CASCADE,
  razorpay_refund_id VARCHAR(255),
  amount_in_rupees   NUMERIC(12, 2) NOT NULL CHECK (amount_in_rupees > 0),
  status             VARCHAR(20)    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  source             VARCHAR(20)    NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'dashboard', 'manual')),
  reason             TEXT,
  created_by         UUID           REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_razorpay_id_unique ON payment_refunds (razorpay_refund_id) WHERE razorpay_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_refunds_payment_idx ON payment_refunds (payment_id);

ALTER TABLE registration_payments DROP CONSTRAINT IF EXISTS registration_payments_refunded_within_amount;
ALTER TABLE registration_payments ADD CONSTRAINT registration_payments_refunded_within_amount
  CHECK (refunded_amount >= 0 AND refunded_amount <= amount_in_rupees);
