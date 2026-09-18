-- AdSlot placements across the site (leaderboard/banner/rectangle).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ad_placement') THEN
    CREATE TYPE ad_placement AS ENUM ('leaderboard', 'banner', 'rectangle');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement  ad_placement NOT NULL,
  page       VARCHAR(255),
  image_url  TEXT         NOT NULL,
  link_url   TEXT,
  cta_label  VARCHAR(255),
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  starts_at  TIMESTAMPTZ,
  ends_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS ads_set_updated_at ON ads;
CREATE TRIGGER ads_set_updated_at
  BEFORE UPDATE ON ads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
