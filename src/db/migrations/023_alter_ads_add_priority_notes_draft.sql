-- Fields from the "Add New Advertisement" form. Drafts are kept inactive
-- (is_active = FALSE) so the public ad slots never serve them.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'medium';
ALTER TABLE ads ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE;
