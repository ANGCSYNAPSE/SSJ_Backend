-- A receipt email is sent once per paid payment / donation. This marks when, so the browser, the webhook and a
-- reconcile can all report the same payment without anyone getting two receipts.
ALTER TABLE registration_payments ADD COLUMN IF NOT EXISTS receipt_emailed_at TIMESTAMPTZ;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS receipt_emailed_at TIMESTAMPTZ;

-- Payments and donations that were paid before this existed must not suddenly email their receipts.
UPDATE registration_payments SET receipt_emailed_at = COALESCE(paid_at, NOW()) WHERE status = 'paid' AND receipt_emailed_at IS NULL;
UPDATE donations SET receipt_emailed_at = updated_at WHERE status = 'paid' AND receipt_emailed_at IS NULL;
