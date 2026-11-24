-- The profile page: a short "about me", and the person's own links (YouTube, Instagram ...). Both optional.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio          VARCHAR(300);
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '{}'::jsonb;
