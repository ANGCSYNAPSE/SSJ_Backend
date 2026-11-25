-- The galleries of the website: photographs and videos that members share. Nothing is shown to the public until an admin has
-- approved it: a new item always starts as 'pending', and only 'approved' items are returned by the public gallery.
--   gallery : 'initiatives' (a folder for every service on the Our Initiatives page) or 'own-wish' (Seva of Own Wish)
--   folder  : the service (its slug) inside the 'initiatives' gallery; 'own-wish' inside the other
CREATE TABLE IF NOT EXISTS gallery_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gallery     VARCHAR(20)  NOT NULL CHECK (gallery IN ('initiatives', 'own-wish')),
  folder      VARCHAR(60)  NOT NULL,
  kind        VARCHAR(10)  NOT NULL CHECK (kind IN ('photo', 'video')),
  url         TEXT         NOT NULL,
  caption     VARCHAR(200),
  status      VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note  TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gallery_items_status_idx ON gallery_items (status, created_at DESC);
CREATE INDEX IF NOT EXISTS gallery_items_public_idx ON gallery_items (gallery, folder) WHERE status = 'approved';
