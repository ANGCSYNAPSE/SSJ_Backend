CREATE TABLE IF NOT EXISTS state_chapters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  slug              VARCHAR(255) NOT NULL,
  members           INTEGER      NOT NULL DEFAULT 0,
  total_members     VARCHAR(50),
  districts_covered VARCHAR(255),
  established       VARCHAR(50),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS state_chapters_slug_unique ON state_chapters (slug);

DROP TRIGGER IF EXISTS state_chapters_set_updated_at ON state_chapters;
CREATE TRIGGER state_chapters_set_updated_at
  BEFORE UPDATE ON state_chapters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
