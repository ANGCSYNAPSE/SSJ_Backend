-- Give Seva: a devotee who cannot be there can ask to SEE their seva being done.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS witness       VARCHAR(10);  -- none | photos | video (recorded, sent after) | live (a video call during the seva)
ALTER TABLE donations ADD COLUMN IF NOT EXISTS witness_time  VARCHAR(12);  -- for a live call: morning | afternoon | evening
ALTER TABLE donations ADD COLUMN IF NOT EXISTS video_number  VARCHAR(30);  -- the WhatsApp number to call, if it is not the phone number given
