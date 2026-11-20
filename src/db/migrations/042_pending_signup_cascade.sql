-- A finished signup (the account was created) is kept only as a record that points at its account. When that account
-- is deleted, the record goes with it, so the same email can register again from the very beginning.
-- Before this, deleting the account left the record behind with its "email verified" and "details saved" marks,
-- and the person was sent straight to the payment step.

-- Clear the leftovers from accounts that were already deleted (a completed signup is marked password_hash = 'completed').
DELETE FROM pending_signups WHERE completed_user_id IS NULL AND password_hash = 'completed';

ALTER TABLE pending_signups DROP CONSTRAINT IF EXISTS pending_signups_completed_user_id_fkey;
ALTER TABLE pending_signups
  ADD CONSTRAINT pending_signups_completed_user_id_fkey
  FOREIGN KEY (completed_user_id) REFERENCES users(id) ON DELETE CASCADE;
