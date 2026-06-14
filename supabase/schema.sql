-- ─────────────────────────────────────────────────────────────────────────────
-- ParceLLA — Supabase Schema
--
-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/YOUR_PROJECT/sql
--
-- Requires PostGIS (enabled by default on Supabase)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable PostGIS for spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- SITES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE sites (
  id              SERIAL PRIMARY KEY,
  address         TEXT NOT NULL,
  neighborhood    TEXT,
  city            TEXT DEFAULT 'Los Angeles',
  zip             TEXT,
  lat             NUMERIC(10,6),
  lng             NUMERIC(10,6),
  geom            GEOMETRY(Point, 4326),
  apn             TEXT,                         -- Assessor Parcel Number
  zoning          TEXT,
  lot_sf          INTEGER,
  project_type    TEXT CHECK (project_type IN ('Multifamily','Mixed-Use','Condo/TH','SFR+ADU')),
  units           INTEGER,
  avg_unit_sf     INTEGER,
  price           BIGINT,
  rti             BOOLEAN DEFAULT FALSE,
  has_demo        BOOLEAN DEFAULT FALSE,
  unit_mix        JSONB DEFAULT '{"studio":0.25,"one":0.5,"two":0.2,"three":0.05}',
  rso_status      TEXT,
  data_source     TEXT DEFAULT 'manual',        -- manual | ladbs | assessor
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','pending','sold','off-market')),
  raw_permit_data JSONB,
  raw_zoning_data JSONB,
  demographics    JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index for map queries
CREATE INDEX sites_geom_idx  ON sites USING GIST(geom);
CREATE INDEX sites_hood_idx  ON sites(neighborhood);
CREATE INDEX sites_type_idx  ON sites(project_type);
CREATE INDEX sites_rti_idx   ON sites(rti);
CREATE INDEX sites_price_idx ON sites(price);

-- Auto-update geom when lat/lng change
CREATE OR REPLACE FUNCTION update_site_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sites_geom_trigger
  BEFORE INSERT OR UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION update_site_geom();

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS (extends Supabase auth.users)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  name       TEXT,
  company    TEXT,
  plan       TEXT DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile when user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- SAVED SITES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE saved_sites (
  user_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
  site_id  INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  notes    TEXT,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, site_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- MODEL OVERRIDES (per user per site)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE model_overrides (
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  site_id    INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  overrides  JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, site_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- DEAL ALERTS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE alerts (
  id         SERIAL PRIMARY KEY,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  filters    JSONB NOT NULL DEFAULT '{}',
  frequency  TEXT DEFAULT 'daily' CHECK (frequency IN ('instant','daily','weekly')),
  active     BOOLEAN DEFAULT TRUE,
  last_run   TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX alerts_user_idx ON alerts(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RENT COMPS (populated from RentCast / Zillow API)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE rent_comps (
  id            SERIAL PRIMARY KEY,
  neighborhood  TEXT NOT NULL,
  zip           TEXT,
  bedroom_type  TEXT NOT NULL CHECK (bedroom_type IN ('studio','one','two','three')),
  monthly_rent  INTEGER NOT NULL,
  source        TEXT DEFAULT 'manual',
  period        DATE DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX rent_comps_hood_idx ON rent_comps(neighborhood);
CREATE INDEX rent_comps_zip_idx  ON rent_comps(zip);

-- Seed with current market data
INSERT INTO rent_comps (neighborhood, bedroom_type, monthly_rent, source) VALUES
  ('Silver Lake','studio',2200,'initial-seed'),('Silver Lake','one',2800,'initial-seed'),
  ('Silver Lake','two',3600,'initial-seed'),('Silver Lake','three',4800,'initial-seed'),
  ('Echo Park','studio',2000,'initial-seed'),('Echo Park','one',2600,'initial-seed'),
  ('Echo Park','two',3300,'initial-seed'),('Echo Park','three',4400,'initial-seed'),
  ('Highland Park','studio',1850,'initial-seed'),('Highland Park','one',2350,'initial-seed'),
  ('Highland Park','two',3000,'initial-seed'),('Highland Park','three',4000,'initial-seed'),
  ('Los Feliz','studio',2300,'initial-seed'),('Los Feliz','one',3000,'initial-seed'),
  ('Los Feliz','two',3900,'initial-seed'),('Los Feliz','three',5200,'initial-seed'),
  ('Koreatown','studio',1700,'initial-seed'),('Koreatown','one',2200,'initial-seed'),
  ('Koreatown','two',2900,'initial-seed'),('Koreatown','three',3800,'initial-seed'),
  ('Mid-Wilshire','studio',2000,'initial-seed'),('Mid-Wilshire','one',2600,'initial-seed'),
  ('Mid-Wilshire','two',3400,'initial-seed'),('Mid-Wilshire','three',4500,'initial-seed'),
  ('Culver City','studio',2400,'initial-seed'),('Culver City','one',3100,'initial-seed'),
  ('Culver City','two',4000,'initial-seed'),('Culver City','three',5300,'initial-seed'),
  ('Mar Vista','studio',2300,'initial-seed'),('Mar Vista','one',2950,'initial-seed'),
  ('Mar Vista','two',3800,'initial-seed'),('Mar Vista','three',5000,'initial-seed'),
  ('West Adams','studio',1900,'initial-seed'),('West Adams','one',2450,'initial-seed'),
  ('West Adams','two',3100,'initial-seed'),('West Adams','three',4100,'initial-seed'),
  ('Boyle Heights','studio',1600,'initial-seed'),('Boyle Heights','one',2050,'initial-seed'),
  ('Boyle Heights','two',2700,'initial-seed'),('Boyle Heights','three',3500,'initial-seed');

-- ─────────────────────────────────────────────────────────────────────────────
-- PERMITS (synced from LADBS Socrata)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE permits (
  id               SERIAL PRIMARY KEY,
  site_id          INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  permit_number    TEXT UNIQUE,
  permit_type      TEXT,
  permit_subtype   TEXT,
  status           TEXT,
  issued_date      DATE,
  expires_date     DATE,
  address          TEXT,
  zone             TEXT,
  work_description TEXT,
  valuation        NUMERIC,
  units            INTEGER,
  lat              NUMERIC(10,6),
  lng              NUMERIC(10,6),
  is_rti           BOOLEAN DEFAULT FALSE,
  raw_data         JSONB,
  synced_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX permits_site_idx    ON permits(site_id);
CREATE INDEX permits_address_idx ON permits(address);
CREATE INDEX permits_rti_idx     ON permits(is_rti);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

-- Sites: public read, authenticated write
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sites are publicly readable"
  ON sites FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert sites"
  ON sites FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Profiles: users see only their own
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Saved sites: users see only their own
ALTER TABLE saved_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own saved sites"
  ON saved_sites USING (auth.uid() = user_id);

-- Model overrides: users see only their own
ALTER TABLE model_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own overrides"
  ON model_overrides USING (auth.uid() = user_id);

-- Alerts: users see only their own
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own alerts"
  ON alerts USING (auth.uid() = user_id);

-- Rent comps and permits: public read
ALTER TABLE rent_comps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rent comps are public" ON rent_comps FOR SELECT USING (true);
ALTER TABLE permits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permits are public" ON permits FOR SELECT USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: 22 development sites
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO sites (address, neighborhood, zip, zoning, lot_sf, project_type, units, avg_unit_sf, price, rti, has_demo, unit_mix, data_source) VALUES
  ('2847 Sunset Blvd','Silver Lake','90026','R3',6250,'Multifamily',12,780,1850000,true,true,'{"studio":0.25,"one":0.5,"two":0.2,"three":0.05}','initial-seed'),
  ('4120 W 3rd St','Koreatown','90020','R4',9800,'Multifamily',24,720,2400000,false,false,'{"studio":0.3,"one":0.45,"two":0.2,"three":0.05}','initial-seed'),
  ('5634 Monte Vista St','Highland Park','90042','R2',5400,'SFR+ADU',3,1100,880000,false,true,'{"studio":0,"one":0.33,"two":0.34,"three":0.33}','initial-seed'),
  ('1921 Glendale Blvd','Echo Park','90026','C2',8500,'Mixed-Use',18,850,3100000,true,true,'{"studio":0.2,"one":0.4,"two":0.3,"three":0.1}','initial-seed'),
  ('3388 Crenshaw Blvd','West Adams','90016','R3',7200,'Multifamily',14,760,1650000,false,false,'{"studio":0.25,"one":0.5,"two":0.2,"three":0.05}','initial-seed'),
  ('6712 Washington Blvd','Culver City','90232','R3',10200,'Condo/TH',8,1400,2750000,true,true,'{"studio":0,"one":0.25,"two":0.5,"three":0.25}','initial-seed'),
  ('4455 Fountain Ave','Los Feliz','90029','RD1.5',7800,'Multifamily',10,900,2100000,false,true,'{"studio":0.2,"one":0.4,"two":0.3,"three":0.1}','initial-seed'),
  ('1102 S Hoover St','Koreatown','90006','R4',8400,'Multifamily',20,700,1950000,true,false,'{"studio":0.35,"one":0.45,"two":0.15,"three":0.05}','initial-seed'),
  ('5901 Venice Blvd','Mar Vista','90291','C2',9600,'Mixed-Use',16,920,3400000,false,true,'{"studio":0.15,"one":0.45,"two":0.3,"three":0.1}','initial-seed'),
  ('3214 N Figueroa St','Highland Park','90065','R3',6000,'Multifamily',8,800,1200000,true,true,'{"studio":0.25,"one":0.5,"two":0.25,"three":0}','initial-seed'),
  ('2250 W Olympic Blvd','Mid-Wilshire','90006','R4',14000,'Multifamily',36,750,4200000,true,false,'{"studio":0.3,"one":0.4,"two":0.2,"three":0.1}','initial-seed'),
  ('1840 Cesar Chavez Ave','Boyle Heights','90033','R3',5800,'Multifamily',10,760,980000,false,true,'{"studio":0.2,"one":0.5,"two":0.25,"three":0.05}','initial-seed'),
  ('4622 Prospect Ave','Los Feliz','90027','R3',8800,'Condo/TH',6,1600,2300000,true,true,'{"studio":0,"one":0.17,"two":0.5,"three":0.33}','initial-seed'),
  ('3755 S La Cienega Blvd','Culver City','90016','C4',18000,'Mixed-Use',48,820,5800000,false,true,'{"studio":0.25,"one":0.45,"two":0.25,"three":0.05}','initial-seed'),
  ('2100 W Silver Lake Dr','Silver Lake','90039','R2',8200,'SFR+ADU',4,1250,1100000,false,true,'{"studio":0,"one":0.25,"two":0.5,"three":0.25}','initial-seed'),
  ('4890 W Adams Blvd','West Adams','90016','R3',6800,'Multifamily',12,770,1400000,true,false,'{"studio":0.25,"one":0.45,"two":0.25,"three":0.05}','initial-seed'),
  ('2780 Virgil Ave','Echo Park','90029','R3',6400,'Multifamily',9,840,1580000,false,true,'{"studio":0.22,"one":0.45,"two":0.22,"three":0.11}','initial-seed'),
  ('6340 Brynhurst Ave','Mar Vista','90043','RD1.5',9000,'Condo/TH',5,1500,2050000,true,true,'{"studio":0,"one":0.2,"two":0.6,"three":0.2}','initial-seed'),
  ('7200 Melrose Ave','Mid-Wilshire','90046','[Q]C2',16500,'Mixed-Use',42,880,6200000,true,true,'{"studio":0.25,"one":0.42,"two":0.25,"three":0.08}','initial-seed'),
  ('3040 Leeward Ave','Koreatown','90006','R4',9200,'Multifamily',22,740,2100000,false,false,'{"studio":0.3,"one":0.45,"two":0.2,"three":0.05}','initial-seed'),
  ('915 N Ave 52','Highland Park','90042','R2',5000,'SFR+ADU',3,1050,750000,true,false,'{"studio":0,"one":0.33,"two":0.34,"three":0.33}','initial-seed'),
  ('1645 Griffith Park Blvd','Silver Lake','90026','R3',7400,'Multifamily',14,800,2200000,false,true,'{"studio":0.22,"one":0.48,"two":0.22,"three":0.08}','initial-seed');
