-- Read-only roll-up of the six category tables, so the admin list and the
-- dashboard counts can query every registration at once without caring which
-- table it lives in. `display_name` is what a person would call the listing
-- (the temple's name, the mandal's name, the artist's own name, ...).
CREATE OR REPLACE VIEW all_registrations AS
  SELECT a.id, a.user_id, 'artist'::registration_type AS type, a.status,
         u.full_name AS display_name, u.full_name, u.email, u.mobile AS phone, a.created_at
    FROM artists a JOIN users u ON u.id = a.user_id
  UNION ALL
  SELECT d.id, d.user_id, 'dancer'::registration_type, d.status,
         u.full_name, u.full_name, u.email, u.mobile, d.created_at
    FROM dancers d JOIN users u ON u.id = d.user_id
  UNION ALL
  SELECT m.id, m.user_id, 'musician'::registration_type, m.status,
         u.full_name, u.full_name, u.email, u.mobile, m.created_at
    FROM musicians m JOIN users u ON u.id = m.user_id
  UNION ALL
  SELECT t.id, t.user_id, 'temple'::registration_type, t.status,
         t.temple_name, u.full_name, u.email, u.mobile, t.created_at
    FROM temples t JOIN users u ON u.id = t.user_id
  UNION ALL
  SELECT s.id, s.user_id, 'dharamshala'::registration_type, s.status,
         s.name, u.full_name, u.email, u.mobile, s.created_at
    FROM dharamshalas s JOIN users u ON u.id = s.user_id
  UNION ALL
  SELECT n.id, n.user_id, 'mandal'::registration_type, n.status,
         n.mandal_name, u.full_name, u.email, u.mobile, n.created_at
    FROM mandals n JOIN users u ON u.id = n.user_id;
