-- The two singleton bio pages: Chairman and Mukhya Trustee.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_profile_key') THEN
    CREATE TYPE team_profile_key AS ENUM ('chairman', 'mukhya_trustee');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS team_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         team_profile_key NOT NULL,
  name        VARCHAR(255)     NOT NULL,
  title       VARCHAR(255)     NOT NULL,
  photo       TEXT,
  quote       TEXT,
  bio         TEXT             NOT NULL DEFAULT '',
  milestones  JSONB            NOT NULL DEFAULT '[]',
  credentials JSONB            NOT NULL DEFAULT '[]',
  social_links JSONB           NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS team_profiles_key_unique ON team_profiles (key);

DROP TRIGGER IF EXISTS team_profiles_set_updated_at ON team_profiles;
CREATE TRIGGER team_profiles_set_updated_at
  BEFORE UPDATE ON team_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
