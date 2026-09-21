-- Devotional communities/groups (e.g. bhajan mandals, satsang circles).
CREATE TABLE IF NOT EXISTS communities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  slug              VARCHAR(255) NOT NULL,
  description       TEXT,
  image             TEXT,
  category          VARCHAR(100),
  member_count      INTEGER      NOT NULL DEFAULT 0,
  daily_discussions INTEGER      NOT NULL DEFAULT 0,
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS communities_slug_unique ON communities (slug);

DROP TRIGGER IF EXISTS communities_set_updated_at ON communities;
CREATE TRIGGER communities_set_updated_at
  BEFORE UPDATE ON communities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
