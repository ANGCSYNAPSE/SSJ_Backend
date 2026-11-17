-- The registration fee is one amount (Rs 1100) that can be paid in parts: at least Rs 501 first,
-- the balance later. So a payment is no longer a "plan" but an installment: 'part' (less than
-- what was still owed), 'full' (cleared the balance) or 'manual' (recorded by an admin).
ALTER TABLE registration_payments DROP CONSTRAINT IF EXISTS registration_payments_plan_check;

UPDATE registration_payments SET plan = 'full' WHERE plan IN ('basic', 'premium');

ALTER TABLE registration_payments
  ADD CONSTRAINT registration_payments_plan_check CHECK (plan IN ('part', 'full', 'manual'));
