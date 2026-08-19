-- Users: devotees, artists, temple admins and platform admins.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('member', 'artist', 'temple_admin', 'admin');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      VARCHAR(120)  NOT NULL,
  email          VARCHAR(255)  NOT NULL,
  mobile         VARCHAR(15)   NOT NULL,
  password_hash  TEXT          NOT NULL,
  role           user_role     NOT NULL DEFAULT 'member',
  is_verified    BOOLEAN       NOT NULL DEFAULT FALSE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- Partial unique indexes: a soft-deleted row must not block re-registration.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON users (email) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_mobile_unique
  ON users (mobile) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
