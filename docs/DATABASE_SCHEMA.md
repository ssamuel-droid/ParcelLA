# ParceLLA Database Schema

## PostgreSQL + PostGIS

```sql
-- Sites
CREATE TABLE sites (
  id            SERIAL PRIMARY KEY,
  address       TEXT NOT NULL,
  neighborhood  TEXT,
  city          TEXT DEFAULT 'Los Angeles',
  zip           TEXT,
  lat           NUMERIC(10,6),
  lng           NUMERIC(10,6),
  geom          GEOMETRY(Point, 4326),
  zoning        TEXT,
  lot_sf        INTEGER,
  type          TEXT,         -- Multifamily, Mixed-Use, Condo/TH, SFR+ADU
  units         INTEGER,
  avg_unit_sf   INTEGER,
  price         BIGINT,
  rti           BOOLEAN DEFAULT FALSE,
  has_demo      BOOLEAN DEFAULT FALSE,
  unit_mix      JSONB,        -- {studio, one, two, three} as decimals
  apn           TEXT,         -- Assessor Parcel Number
  source        TEXT,         -- LA Assessor | LADBS | Broker
  status        TEXT DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX sites_geom_idx ON sites USING GIST(geom);
CREATE INDEX sites_neighborhood_idx ON sites(neighborhood);
CREATE INDEX sites_type_idx ON sites(type);

-- Users
CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  name       TEXT,
  plan       TEXT DEFAULT 'free',   -- free | pro | enterprise
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved sites
CREATE TABLE saved_sites (
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  site_id    INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  saved_at   TIMESTAMPTZ DEFAULT NOW(),
  notes      TEXT,
  PRIMARY KEY (user_id, site_id)
);

-- Deal alerts
CREATE TABLE alerts (
  id         SERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  filters    JSONB NOT NULL,   -- mirrors search filter state
  frequency  TEXT DEFAULT 'daily',
  active     BOOLEAN DEFAULT TRUE,
  last_run   TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Model overrides (saved per user per site)
CREATE TABLE model_overrides (
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  site_id        INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  overrides      JSONB NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, site_id)
);

-- Rent comps (populated from Zillow API)
CREATE TABLE rent_comps (
  id            SERIAL PRIMARY KEY,
  neighborhood  TEXT NOT NULL,
  zip           TEXT,
  bedroom_type  TEXT NOT NULL,  -- studio | one | two | three
  monthly_rent  INTEGER,
  source        TEXT,
  period        DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Permit data (populated from LADBS open data)
CREATE TABLE permits (
  id              SERIAL PRIMARY KEY,
  site_id         INTEGER REFERENCES sites(id),
  permit_number   TEXT,
  permit_type     TEXT,
  status          TEXT,
  issued_date     DATE,
  address         TEXT,
  work_description TEXT,
  is_rti          BOOLEAN DEFAULT FALSE,
  raw_data        JSONB,
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);
```
