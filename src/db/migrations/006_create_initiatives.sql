-- "Our Initiatives" home page cards. `"desc"` is quoted because DESC is a
-- reserved SQL keyword; the repository layer always quotes identifiers.
CREATE TABLE IF NOT EXISTS initiatives (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag        VARCHAR(255) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  "desc"     TEXT         NOT NULL,
  image      TEXT         NOT NULL,
  "order"    INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS initiatives_set_updated_at ON initiatives;
CREATE TRIGGER initiatives_set_updated_at
  BEFORE UPDATE ON initiatives
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
