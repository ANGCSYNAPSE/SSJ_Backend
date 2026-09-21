-- Extra fields for the full event editor: venue/capacity details, organizer
-- contact info, and SEO metadata for the public event page.
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_address TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_limit INTEGER;
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_name VARCHAR(255);
ALTER TABLE events ADD COLUMN IF NOT EXISTS contact_number VARCHAR(30);
ALTER TABLE events ADD COLUMN IF NOT EXISTS slug VARCHAR(255);
ALTER TABLE events ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255);
ALTER TABLE events ADD COLUMN IF NOT EXISTS meta_description TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS focus_keywords JSONB NOT NULL DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_indexed BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS events_slug_unique ON events (slug) WHERE slug IS NOT NULL;
