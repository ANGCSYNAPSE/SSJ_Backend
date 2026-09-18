-- "Person card" on the Team pages — trustee/management/advisory boards plus
-- each state's leadership and district members, distinguished by `section`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_section') THEN
    CREATE TYPE team_section AS ENUM
      ('trustee', 'management', 'advisory', 'state_leadership', 'district_member');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS team_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section       team_section NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(255) NOT NULL,
  photo         TEXT,
  bio           TEXT,
  location      VARCHAR(255),
  unit          VARCHAR(255),
  "order"       INTEGER      NOT NULL DEFAULT 0,
  state_slug    VARCHAR(255),
  district_name VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS team_members_set_updated_at ON team_members;
CREATE TRIGGER team_members_set_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
