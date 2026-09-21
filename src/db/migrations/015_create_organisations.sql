-- Partner organisations (trusts, samitis, NGOs) shown on the public site and
-- tracked in the admin dashboard.
CREATE TABLE IF NOT EXISTS organisations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) NOT NULL,
  description   TEXT,
  logo          TEXT,
  category      VARCHAR(100),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(30),
  established   VARCHAR(50),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS organisations_slug_unique ON organisations (slug);

DROP TRIGGER IF EXISTS organisations_set_updated_at ON organisations;
CREATE TRIGGER organisations_set_updated_at
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
