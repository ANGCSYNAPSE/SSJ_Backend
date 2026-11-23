-- Which spot on the page an ad goes in, counting the spots of its size from the top of the page (1 = the first one).
-- Empty = any spot of that size on the page; the ads without a position share the spots out between them.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS slot_position SMALLINT CHECK (slot_position IS NULL OR slot_position BETWEEN 1 AND 9);
