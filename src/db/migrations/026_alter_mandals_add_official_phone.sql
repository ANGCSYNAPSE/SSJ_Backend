-- The mandal form asks for the organisation's own phone, separate from the
-- president's (who holds the login account).
ALTER TABLE mandals ADD COLUMN IF NOT EXISTS official_phone VARCHAR(30);
