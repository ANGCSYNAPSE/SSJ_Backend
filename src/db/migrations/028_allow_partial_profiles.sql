-- People may submit a registration with some details still blank and finish
-- later. Each profile records which required details are missing, so the
-- admin and the user can see it is incomplete.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['artists', 'dancers', 'musicians', 'temples', 'dharamshalas', 'mandals'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS missing_fields JSONB NOT NULL DEFAULT ''[]''', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['artists', 'dancers', 'musicians'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN city DROP NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN state DROP NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN primary_specialty DROP NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN experience DROP NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN bio DROP NOT NULL', t);
  END LOOP;
END $$;

ALTER TABLE temples ALTER COLUMN temple_name DROP NOT NULL;
ALTER TABLE temples ALTER COLUMN deity DROP NOT NULL;
ALTER TABLE temples ALTER COLUMN temple_type DROP NOT NULL;
ALTER TABLE temples ALTER COLUMN address DROP NOT NULL;
ALTER TABLE temples ALTER COLUMN city DROP NOT NULL;
ALTER TABLE temples ALTER COLUMN state DROP NOT NULL;
ALTER TABLE temples ALTER COLUMN pin_code DROP NOT NULL;
ALTER TABLE temples ALTER COLUMN description DROP NOT NULL;

ALTER TABLE dharamshalas ALTER COLUMN name DROP NOT NULL;
ALTER TABLE dharamshalas ALTER COLUMN license_number DROP NOT NULL;
ALTER TABLE dharamshalas ALTER COLUMN distance_from_temple DROP NOT NULL;
ALTER TABLE dharamshalas ALTER COLUMN address DROP NOT NULL;
ALTER TABLE dharamshalas ALTER COLUMN state DROP NOT NULL;
ALTER TABLE dharamshalas ALTER COLUMN total_rooms DROP NOT NULL;
ALTER TABLE dharamshalas ALTER COLUMN pricing_mode DROP NOT NULL;

ALTER TABLE mandals ALTER COLUMN mandal_name DROP NOT NULL;
ALTER TABLE mandals ALTER COLUMN mandal_type DROP NOT NULL;
ALTER TABLE mandals ALTER COLUMN state DROP NOT NULL;
ALTER TABLE mandals ALTER COLUMN city DROP NOT NULL;
ALTER TABLE mandals ALTER COLUMN address DROP NOT NULL;

-- Same roll-up as before plus the completeness of each profile. Display names
-- fall back to a label when the person hasn't typed the temple/mandal name yet.
CREATE OR REPLACE VIEW all_registrations AS
  SELECT a.id, a.user_id, 'artist'::registration_type AS type, a.status,
         u.full_name AS display_name, u.full_name, u.email, u.mobile AS phone, a.created_at,
         (jsonb_array_length(a.missing_fields) = 0) AS is_complete, a.missing_fields
    FROM artists a JOIN users u ON u.id = a.user_id
  UNION ALL
  SELECT d.id, d.user_id, 'dancer'::registration_type, d.status,
         u.full_name, u.full_name, u.email, u.mobile, d.created_at,
         (jsonb_array_length(d.missing_fields) = 0), d.missing_fields
    FROM dancers d JOIN users u ON u.id = d.user_id
  UNION ALL
  SELECT m.id, m.user_id, 'musician'::registration_type, m.status,
         u.full_name, u.full_name, u.email, u.mobile, m.created_at,
         (jsonb_array_length(m.missing_fields) = 0), m.missing_fields
    FROM musicians m JOIN users u ON u.id = m.user_id
  UNION ALL
  SELECT t.id, t.user_id, 'temple'::registration_type, t.status,
         COALESCE(t.temple_name, '(temple name not added yet)'), u.full_name, u.email, u.mobile, t.created_at,
         (jsonb_array_length(t.missing_fields) = 0), t.missing_fields
    FROM temples t JOIN users u ON u.id = t.user_id
  UNION ALL
  SELECT s.id, s.user_id, 'dharamshala'::registration_type, s.status,
         COALESCE(s.name, '(dharamshala name not added yet)'), u.full_name, u.email, u.mobile, s.created_at,
         (jsonb_array_length(s.missing_fields) = 0), s.missing_fields
    FROM dharamshalas s JOIN users u ON u.id = s.user_id
  UNION ALL
  SELECT n.id, n.user_id, 'mandal'::registration_type, n.status,
         COALESCE(n.mandal_name, '(mandal name not added yet)'), u.full_name, u.email, u.mobile, n.created_at,
         (jsonb_array_length(n.missing_fields) = 0), n.missing_fields
    FROM mandals n JOIN users u ON u.id = n.user_id;
