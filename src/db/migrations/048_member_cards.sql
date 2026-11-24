-- A shareable digital card for each account. The code is the secret part of the card's link (/card/<code>); the card is
-- visible to the public only while the owner has switched sharing on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_code VARCHAR(12);
ALTER TABLE users ADD COLUMN IF NOT EXISTS card_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS users_card_code_key ON users (card_code) WHERE card_code IS NOT NULL;
