-- One table per registration category. Each row belongs to a user account
-- (user_id), so a person signs up once and sign-in works the same for everyone;
-- the category tables only hold the extra details and the admin approval state.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_member BOOLEAN NOT NULL DEFAULT FALSE;

-- Artists, dancers and musicians collect the same details.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['artists', 'dancers', 'musicians'] LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status              registration_status NOT NULL DEFAULT 'pending',
        admin_note          TEXT,
        date_of_birth       DATE,
        gender              VARCHAR(30),
        city                VARCHAR(100) NOT NULL,
        state               VARCHAR(100) NOT NULL,
        profile_photo       TEXT,
        primary_specialty   VARCHAR(100) NOT NULL,
        secondary_specialty VARCHAR(100),
        experience          VARCHAR(30)  NOT NULL,
        guru_name           VARCHAR(150),
        bio                 TEXT         NOT NULL,
        portfolio_link      TEXT,
        available_events    JSONB        NOT NULL DEFAULT '[]',
        regions             JSONB        NOT NULL DEFAULT '[]',
        honorarium          VARCHAR(50),
        travel_willingness  VARCHAR(30),
        consent_contact     BOOLEAN      NOT NULL DEFAULT FALSE,
        work_files          JSONB        NOT NULL DEFAULT '[]',
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )$f$, t);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS temples (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              registration_status NOT NULL DEFAULT 'pending',
  admin_note          TEXT,
  temple_name         VARCHAR(255) NOT NULL,
  deity               VARCHAR(150) NOT NULL,
  temple_type         VARCHAR(50)  NOT NULL,
  year_established    VARCHAR(20),
  trust_name          VARCHAR(255),
  registration_number VARCHAR(100),
  address             TEXT         NOT NULL,
  city                VARCHAR(100) NOT NULL,
  state               VARCHAR(100) NOT NULL,
  pin_code            VARCHAR(10)  NOT NULL,
  maps_link           TEXT,
  opening_time        VARCHAR(30),
  closing_time        VARCHAR(30),
  aarti_timings       TEXT,
  services            JSONB        NOT NULL DEFAULT '[]',
  description         TEXT         NOT NULL,
  primary_photo       TEXT,
  gallery             JSONB        NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dharamshalas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status               registration_status NOT NULL DEFAULT 'pending',
  admin_note           TEXT,
  name                 VARCHAR(255) NOT NULL,
  trust_name           VARCHAR(255),
  license_number       VARCHAR(100) NOT NULL,
  distance_from_temple VARCHAR(50)  NOT NULL,
  address              TEXT         NOT NULL,
  state                VARCHAR(100) NOT NULL,
  manager_name         VARCHAR(150),
  total_rooms          INTEGER      NOT NULL,
  dormitory_beds       VARCHAR(100),
  pricing_mode         VARCHAR(50)  NOT NULL,
  suggested_price      NUMERIC(10, 2),
  amenities            JSONB        NOT NULL DEFAULT '[]',
  cover_photo          TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mandals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              registration_status NOT NULL DEFAULT 'pending',
  admin_note          TEXT,
  mandal_name         VARCHAR(255) NOT NULL,
  mandal_type         VARCHAR(100) NOT NULL,
  founding_year       VARCHAR(10),
  registration_number VARCHAR(100),
  state               VARCHAR(100) NOT NULL,
  city                VARCHAR(100) NOT NULL,
  address             TEXT         NOT NULL,
  president_name      VARCHAR(150) NOT NULL,
  president_phone     VARCHAR(30),
  member_count_band   VARCHAR(50),
  spokesperson_name   VARCHAR(150),
  seva_types          JSONB        NOT NULL DEFAULT '[]',
  recurring_events    TEXT,
  logo                TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- A person has at most one profile per category; status drives admin review.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['artists', 'dancers', 'musicians', 'temples', 'dharamshalas', 'mandals'] LOOP
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (user_id)', t || '_user_unique', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (status)', t || '_status_idx', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_set_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END $$;
