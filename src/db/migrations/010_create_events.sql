CREATE TABLE IF NOT EXISTS events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        VARCHAR(255) NOT NULL,
  description  TEXT         NOT NULL,
  image        TEXT,
  location     VARCHAR(255) NOT NULL,
  start_date   TIMESTAMPTZ  NOT NULL,
  end_date     TIMESTAMPTZ,
  type         VARCHAR(100) NOT NULL,
  is_published BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS events_set_updated_at ON events;
CREATE TRIGGER events_set_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Volunteer sign-ups for a specific event (the "Register" button on Events).
CREATE TABLE IF NOT EXISTS event_volunteers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID         NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  full_name  VARCHAR(255) NOT NULL,
  email      VARCHAR(255) NOT NULL,
  phone      VARCHAR(30)  NOT NULL,
  message    TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_volunteers_event_id_idx ON event_volunteers (event_id);

DROP TRIGGER IF EXISTS event_volunteers_set_updated_at ON event_volunteers;
CREATE TRIGGER event_volunteers_set_updated_at
  BEFORE UPDATE ON event_volunteers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
