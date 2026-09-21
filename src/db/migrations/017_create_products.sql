-- Shop/prasad products sold or listed on the public site.
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255)   NOT NULL,
  slug        VARCHAR(255)   NOT NULL,
  description TEXT,
  image       TEXT,
  category    VARCHAR(100),
  price       NUMERIC(10, 2) NOT NULL DEFAULT 0,
  stock       INTEGER        NOT NULL DEFAULT 0,
  is_active   BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_slug_unique ON products (slug);

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
