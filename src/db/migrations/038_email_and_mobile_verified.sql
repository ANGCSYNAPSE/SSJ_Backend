-- Three separate marks on an account:
--   email_verified_at   the person proved the email is theirs (the code emailed at signup)
--   mobile_verified_at  the person proved the mobile is theirs (SMS code; not wired up yet)
--   is_verified         an admin has checked the person's details (set from the admin's Verification page)
-- Until now signup set is_verified itself when the email code was entered, so it really meant "email verified".
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_verified_at TIMESTAMPTZ;

-- Everyone who came through the emailed-code signup did verify their email.
UPDATE users u SET email_verified_at = COALESCE(p.email_verified_at, u.created_at)
  FROM pending_signups p
 WHERE p.completed_user_id = u.id AND p.email_verified_at IS NOT NULL AND u.email_verified_at IS NULL;

-- Nobody has been checked by an admin yet, so those automatic marks no longer count as admin-verified.
UPDATE users SET is_verified = FALSE, verified_at = NULL
 WHERE role <> 'admin' AND is_verified = TRUE AND verified_by IS NULL;
