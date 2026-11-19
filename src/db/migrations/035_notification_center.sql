-- The notification centre: every message a signed-in person gets (admin announcements, event and
-- update news, payment receipts, registration decisions) lives in `notifications` and is shown in the
-- site's bell. A message sent to many people at once is one row in notification_broadcasts, so the
-- admin can see how far it reached and how many people read it.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category     VARCHAR(20) NOT NULL DEFAULT 'announcement';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS broadcast_id UUID;
-- A system message that must reach a person only once (e.g. "payment received" for one order) carries a key;
-- sending it twice is a no-op.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key   VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_unique ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_broadcast_idx ON notifications (broadcast_id) WHERE broadcast_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_broadcasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(100),
  message         TEXT         NOT NULL,
  kind            VARCHAR(20)  NOT NULL DEFAULT 'info',
  category        VARCHAR(20)  NOT NULL DEFAULT 'announcement',
  link            VARCHAR(255),
  audience        JSONB        NOT NULL,
  recipient_count INTEGER      NOT NULL DEFAULT 0,
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_broadcasts_created_idx ON notification_broadcasts (created_at DESC);
