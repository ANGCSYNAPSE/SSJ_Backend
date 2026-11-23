-- The button on a text-and-picture ad can have its own colour, so it can follow the picture. Empty = the colour scheme's default.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS cta_color VARCHAR(9);
