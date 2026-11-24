-- Give Seva: what the devotee tells us about HOW they would like the seva done.
-- All optional. (The reason and prayer already go in "message", the name it is given in goes in "dedicated_to".)
ALTER TABLE donations ADD COLUMN IF NOT EXISTS instructions TEXT;         -- "serve the meal on Ekadashi", "for the elders' home near me" ...
ALTER TABLE donations ADD COLUMN IF NOT EXISTS gotra        VARCHAR(60);  -- for the sankalp, as temples ask for it
ALTER TABLE donations ADD COLUMN IF NOT EXISTS attend       VARCHAR(10);  -- would they like to be present or take part: yes | maybe | no
ALTER TABLE donations ADD COLUMN IF NOT EXISTS updates      VARCHAR(12);  -- how they want to hear that it is done: whatsapp | call | email | none
