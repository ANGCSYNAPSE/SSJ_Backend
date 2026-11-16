-- Fields from the original registration forms that had no column yet: the
-- dharamshala verification documents, the mandal's registration document, and
-- the temple's communications opt-in.
ALTER TABLE dharamshalas ADD COLUMN IF NOT EXISTS trust_certificate TEXT;
ALTER TABLE dharamshalas ADD COLUMN IF NOT EXISTS property_photos JSONB NOT NULL DEFAULT '[]';
ALTER TABLE dharamshalas ADD COLUMN IF NOT EXISTS manager_id_proof TEXT;

ALTER TABLE mandals ADD COLUMN IF NOT EXISTS registration_document TEXT;

ALTER TABLE temples ADD COLUMN IF NOT EXISTS consent_comms BOOLEAN NOT NULL DEFAULT FALSE;
