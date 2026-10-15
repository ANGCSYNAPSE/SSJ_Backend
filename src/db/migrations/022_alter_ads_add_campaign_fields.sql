-- Campaign details shown in the admin Advertisement Management table.
-- impressions/clicks are stored counters for a future tracking endpoint to increment.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE ads ADD COLUMN IF NOT EXISTS advertiser VARCHAR(255);
ALTER TABLE ads ADD COLUMN IF NOT EXISTS ad_type VARCHAR(100);
ALTER TABLE ads ADD COLUMN IF NOT EXISTS impressions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS revenue_rupees NUMERIC(12, 2) NOT NULL DEFAULT 0;
