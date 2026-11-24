-- "Give Seva": a donation that is made for a chosen seva, with the details a devotee adds to it.
-- All optional, so the ordinary donation page keeps working exactly as before.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS seva_type      VARCHAR(60);   -- e.g. annadan, gaushala (the slug of the initiative)
ALTER TABLE donations ADD COLUMN IF NOT EXISTS occasion       VARCHAR(60);   -- birthday, in memory of, thanksgiving ...
ALTER TABLE donations ADD COLUMN IF NOT EXISTS dedicated_to   VARCHAR(120);  -- "in the name of ..."
ALTER TABLE donations ADD COLUMN IF NOT EXISTS message        TEXT;          -- the prayer / sankalp
ALTER TABLE donations ADD COLUMN IF NOT EXISTS preferred_date DATE;          -- the day they would like the seva done
ALTER TABLE donations ADD COLUMN IF NOT EXISTS city           VARCHAR(80);
ALTER TABLE donations ADD COLUMN IF NOT EXISTS pay_method     VARCHAR(20);   -- what the donor picked: upi, card, netbanking, wallet, any

CREATE INDEX IF NOT EXISTS donations_seva_type_idx ON donations (seva_type) WHERE seva_type IS NOT NULL;
