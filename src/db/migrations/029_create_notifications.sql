-- Short messages an admin sends to a user ("please complete your temple
-- profile"). The site shows each one as a toast the next time the user is
-- signed in, then marks it read.
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       VARCHAR(20)  NOT NULL DEFAULT 'info',
  title      VARCHAR(100),
  message    TEXT         NOT NULL,
  link       VARCHAR(255),
  created_by UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  read_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);
