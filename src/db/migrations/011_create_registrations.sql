-- One table for all 6 registration forms (artist, dancer, musician, temple,
-- dharamshala, mandal) — `type` says which form, `details` holds fields
-- specific to that form.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registration_type') THEN
    CREATE TYPE registration_type AS ENUM
      ('artist', 'dancer', 'musician', 'temple', 'dharamshala', 'mandal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registration_status') THEN
    CREATE TYPE registration_status AS ENUM ('pending', 'approved', 'rejected', 'blocked');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS registrations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        registration_type   NOT NULL,
  status      registration_status NOT NULL DEFAULT 'pending',
  full_name   VARCHAR(255)        NOT NULL,
  email       VARCHAR(255)        NOT NULL,
  phone       VARCHAR(30)         NOT NULL,
  details     JSONB               NOT NULL DEFAULT '{}',
  attachments JSONB               NOT NULL DEFAULT '[]',
  admin_note  TEXT,
  created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS registrations_type_status_idx ON registrations (type, status);

DROP TRIGGER IF EXISTS registrations_set_updated_at ON registrations;
CREATE TRIGGER registrations_set_updated_at
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
