-- Admin user management (block/unblock) needs a flag the original users
-- table didn't have yet.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;
