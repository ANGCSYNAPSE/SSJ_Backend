-- Ads become designed templates, not only an uploaded picture.
--   template: 'image' = the uploaded picture is the whole ad (as before)
--             'split' = a coloured panel with a headline, a line of text and a button on the left, a picture on the right
-- The picture is optional for 'split', so image_url may now be empty.
ALTER TABLE ads ALTER COLUMN image_url DROP NOT NULL;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS template VARCHAR(20) NOT NULL DEFAULT 'image';
ALTER TABLE ads ADD COLUMN IF NOT EXISTS headline VARCHAR(160);
ALTER TABLE ads ADD COLUMN IF NOT EXISTS subline VARCHAR(200);
-- A named colour scheme, or 'custom' together with the two colours below.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS theme VARCHAR(20) NOT NULL DEFAULT 'maroon';
ALTER TABLE ads ADD COLUMN IF NOT EXISTS bg_from VARCHAR(9);
ALTER TABLE ads ADD COLUMN IF NOT EXISTS bg_to VARCHAR(9);
