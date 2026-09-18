-- Small editable blocks on the Donation page — causes, testimonials, impact
-- stats, breakdown slices — distinguished by `type`; `data` holds whatever
-- fields that type needs so the frontend renders it directly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'donation_content_type') THEN
    CREATE TYPE donation_content_type AS ENUM
      ('cause', 'testimonial', 'impact_stat', 'breakdown_slice');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS donation_content (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       donation_content_type NOT NULL,
  "order"    INTEGER               NOT NULL DEFAULT 0,
  data       JSONB                 NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS donation_content_set_updated_at ON donation_content;
CREATE TRIGGER donation_content_set_updated_at
  BEFORE UPDATE ON donation_content
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
