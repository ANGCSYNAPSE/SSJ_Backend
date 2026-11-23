-- Volunteers: free accounts for people who want to give their time to seva. A volunteer is an ordinary account (a user) with
-- one extra row here: the seva they want to help with, their skills and availability, and the admin's review.
-- No registration fee is charged; a volunteer can pay it later if they want to become a member.
CREATE TABLE IF NOT EXISTS volunteers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status       registration_status NOT NULL DEFAULT 'pending',
  admin_note   TEXT,
  interests    JSONB        NOT NULL DEFAULT '[]',
  skills       JSONB        NOT NULL DEFAULT '[]',
  availability VARCHAR(60),
  city         VARCHAR(100) NOT NULL,
  state        VARCHAR(100) NOT NULL,
  about        TEXT,
  reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS volunteers_status_idx ON volunteers (status);
CREATE INDEX IF NOT EXISTS volunteers_state_city_idx ON volunteers (state, city);

DROP TRIGGER IF EXISTS volunteers_set_updated_at ON volunteers;
CREATE TRIGGER volunteers_set_updated_at
  BEFORE UPDATE ON volunteers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
