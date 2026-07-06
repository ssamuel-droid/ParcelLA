-- ─────────────────────────────────────────────────────────────────────────────
-- ParceLLA — Complete Supabase Schema v2
-- Run in: supabase.com → your project → SQL Editor → paste → Run
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy address search

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
  apn             TEXT,
  zoning          TEXT,
  lot_sf          INTEGER,
  project_type    TEXT CHECK (project_type IN ('Multifamily','Mixed-Use','Condo/TH','SFR+ADU')),
  units           INTEGER,
  avg_unit_sf     INTEGER,
  price           BIGINT,
  rti             BOOLEAN DEFAULT FALSE,
  has_demo        BOOLEAN DEFAULT FALSE,
  unit_mix        JSONB DEFAULT '{"studio":0.25,"one":0.5,"two":0.2,"three":0.05}',
  estimated_units BOOLEAN DEFAULT FALSE,
  noi             BIGINT,
  total_cost      BIGINT,
  exit_value      BIGINT,
  net_profit      BIGINT,
  irr_v           NUMERIC(8,2),
  cap_on_cost     NUMERIC(8,2),
  dev_spread_pct  NUMERIC(8,2),
  permit_source_id TEXT,
  underwritten_at TIMESTAMPTZ,
  rso_status      TEXT,
  data_source     TEXT DEFAULT 'manual',
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','pending','sold','off-market')),
  is_comp         BOOLEAN DEFAULT FALSE,
  raw_permit_data JSONB,
  raw_zoning_data JSONB,
  demographics    JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX sites_geom_idx  ON sites USING GIST(geom);
CREATE INDEX sites_hood_idx  ON sites(neighborhood);
CREATE INDEX sites_type_idx  ON sites(project_type);
CREATE INDEX sites_rti_idx   ON sites(rti);
CREATE INDEX sites_price_idx ON sites(price);
CREATE INDEX sites_addr_trgm ON sites USING GIN(address gin_trgm_ops);
CREATE INDEX sites_irr_idx ON sites(irr_v DESC);
CREATE INDEX sites_profit_idx ON sites(net_profit DESC);
CREATE UNIQUE INDEX sites_permit_source_uidx ON sites(permit_source_id);

CREATE OR REPLACE FUNCTION update_site_geom() RETURNS TRIGGER AS $$
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
-- PROFILES (extends Supabase auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT,
  name          TEXT,
  company       TEXT,
  plan          TEXT DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT DEFAULT 'inactive',
  trial_ends_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name');
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
-- DEAL NOTES (new)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE deal_notes (
  id         SERIAL PRIMARY KEY,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  site_id    INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  pinned     BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX notes_site_idx ON deal_notes(site_id);
CREATE INDEX notes_user_idx ON deal_notes(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- MODEL OVERRIDES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE model_overrides (
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  site_id    INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  overrides  JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, site_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ALERTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE alerts (
  id         SERIAL PRIMARY KEY,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  filters    JSONB NOT NULL DEFAULT '{}',
  frequency  TEXT DEFAULT 'daily' CHECK (frequency IN ('instant','daily','weekly')),
  active     BOOLEAN DEFAULT TRUE,
  last_run   TIMESTAMPTZ,
  hit_count  INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX alerts_user_idx ON alerts(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RENT COMPS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE rent_comps (
  id            SERIAL PRIMARY KEY,
  neighborhood  TEXT NOT NULL,
  zip           TEXT,
  property_name TEXT,
  address       TEXT,
  lat           NUMERIC(10,6),
  lng           NUMERIC(10,6),
  units         INTEGER,
  avg_unit_sf   INTEGER,
  year_built    INTEGER,
  amenities     TEXT,
  property_url  TEXT,
  notes         TEXT,
  bedroom_type  TEXT NOT NULL CHECK (bedroom_type IN ('studio','one','two','three')),
  monthly_rent  INTEGER NOT NULL,
  source        TEXT DEFAULT 'manual',
  period        DATE DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX rent_comps_hood_idx ON rent_comps(neighborhood, bedroom_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- SOLD COMPS (new)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sold_comps (
  id              SERIAL PRIMARY KEY,
  address         TEXT NOT NULL,
  neighborhood    TEXT,
  zip             TEXT,
  lat             NUMERIC(10,6),
  lng             NUMERIC(10,6),
  geom            GEOMETRY(Point, 4326),
  project_type    TEXT,
  units           INTEGER,
  avg_unit_sf     INTEGER,
  year_built      INTEGER,
  amenities       TEXT,
  sale_price      BIGINT NOT NULL,
  sale_date       DATE NOT NULL,
  cap_rate        NUMERIC(5,4),       -- actual cap rate at sale
  noi             BIGINT,             -- NOI at time of sale
  price_per_unit  INTEGER,
  price_per_sf    INTEGER,
  buyer           TEXT,
  seller          TEXT,
  source          TEXT DEFAULT 'manual',
  notes           TEXT,
  apn             TEXT,
  recorder_document_number TEXT,
  document_type   TEXT,
  transfer_tax    NUMERIC,
  sale_price_confidence TEXT,
  sale_price_method TEXT,
  raw_record      JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX sold_comps_hood_idx  ON sold_comps(neighborhood);
CREATE INDEX sold_comps_date_idx  ON sold_comps(sale_date DESC);
CREATE UNIQUE INDEX sold_comps_recorder_document_number_uidx ON sold_comps(recorder_document_number);
CREATE INDEX sold_comps_apn_idx ON sold_comps(apn);
CREATE INDEX sold_comps_type_idx  ON sold_comps(project_type);
CREATE INDEX sold_comps_geom_idx  ON sold_comps USING GIST(geom);

CREATE OR REPLACE FUNCTION update_sold_comp_geom() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sold_comps_geom_trigger
  BEFORE INSERT OR UPDATE ON sold_comps
  FOR EACH ROW EXECUTE FUNCTION update_sold_comp_geom();

-- ─────────────────────────────────────────────────────────────────────────────
-- PERMITS (LADBS sync)
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
-- SHARE LINKS (new)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE share_links (
  token       TEXT PRIMARY KEY,
  site_id     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  overrides   JSONB DEFAULT '{}',
  preset      TEXT DEFAULT 'institutional',
  label       TEXT,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  view_count  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX share_links_site_idx    ON share_links(site_id);
CREATE INDEX share_links_expires_idx ON share_links(expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- NARRATIVES CACHE (new)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE narratives (
  site_id     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  model_hash  TEXT NOT NULL,
  narrative   TEXT NOT NULL,
  tokens_used INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (site_id, model_hash)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ACTIVITY LOG (new)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE activity_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,   -- 'view_site','save_site','generate_pdf','generate_narrative','share_link','signin'
  site_id    INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  metadata   JSONB DEFAULT '{}',
  ip         TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX activity_user_idx ON activity_log(user_id, created_at DESC);
CREATE INDEX activity_site_idx ON activity_log(site_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- SUBSCRIPTIONS / STRIPE (new)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE subscription_events (
  id              BIGSERIAL PRIMARY KEY,
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type      TEXT NOT NULL,
  user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  stripe_data     JSONB NOT NULL,
  processed_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SYNC LOG
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sync_log (
  id       SERIAL PRIMARY KEY,
  source   TEXT NOT NULL,
  records  INTEGER DEFAULT 0,
  status   TEXT DEFAULT 'ok',
  error    TEXT,
  ran_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_sites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_overrides  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_comps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sold_comps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE permits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links      ENABLE ROW LEVEL SECURITY;
ALTER TABLE narratives       ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log     ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Sites public read"       ON sites       FOR SELECT USING (true);
CREATE POLICY "Rent comps public read"  ON rent_comps  FOR SELECT USING (true);
CREATE POLICY "Sold comps public read"  ON sold_comps  FOR SELECT USING (true);
CREATE POLICY "Permits public read"     ON permits     FOR SELECT USING (true);
CREATE POLICY "Share links public read" ON share_links FOR SELECT USING (true);
CREATE POLICY "Narratives public read"  ON narratives  FOR SELECT USING (true);

-- Auth insert
CREATE POLICY "Auth can insert sites"   ON sites       FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Auth can insert sold"    ON sold_comps  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Own-data only
CREATE POLICY "Own profile"      ON profiles        USING (auth.uid() = id);
CREATE POLICY "Own saved sites"  ON saved_sites     USING (auth.uid() = user_id);
CREATE POLICY "Own notes"        ON deal_notes      USING (auth.uid() = user_id);
CREATE POLICY "Own overrides"    ON model_overrides USING (auth.uid() = user_id);
CREATE POLICY "Own alerts"       ON alerts          USING (auth.uid() = user_id);
CREATE POLICY "Own activity"     ON activity_log    USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEWS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW rti_sites AS
  SELECT s.id, s.address, s.neighborhood, s.zoning, s.units, s.price,
    p.permit_number, p.status AS permit_status, p.issued_date, p.work_description
  FROM sites s
  JOIN permits p ON p.site_id = s.id
  WHERE p.is_rti = true AND s.status = 'active'
  ORDER BY p.issued_date DESC;

CREATE OR REPLACE VIEW submarket_cap_rates AS
  SELECT neighborhood,
    AVG(cap_rate) AS avg_cap_rate,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cap_rate) AS median_cap_rate,
    COUNT(*) AS comp_count,
    MAX(sale_date) AS latest_sale,
    AVG(price_per_unit) AS avg_price_per_unit
  FROM sold_comps
  WHERE cap_rate IS NOT NULL AND sale_date > NOW() - INTERVAL '2 years'
  GROUP BY neighborhood;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: rent comps
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO rent_comps (neighborhood, bedroom_type, monthly_rent, source) VALUES
  ('Silver Lake','studio',2200,'seed'),('Silver Lake','one',2800,'seed'),
  ('Silver Lake','two',3600,'seed'),('Silver Lake','three',4800,'seed'),
  ('Echo Park','studio',2000,'seed'),('Echo Park','one',2600,'seed'),
  ('Echo Park','two',3300,'seed'),('Echo Park','three',4400,'seed'),
  ('Highland Park','studio',1850,'seed'),('Highland Park','one',2350,'seed'),
  ('Highland Park','two',3000,'seed'),('Highland Park','three',4000,'seed'),
  ('Los Feliz','studio',2300,'seed'),('Los Feliz','one',3000,'seed'),
  ('Los Feliz','two',3900,'seed'),('Los Feliz','three',5200,'seed'),
  ('Koreatown','studio',1700,'seed'),('Koreatown','one',2200,'seed'),
  ('Koreatown','two',2900,'seed'),('Koreatown','three',3800,'seed'),
  ('Mid-Wilshire','studio',2000,'seed'),('Mid-Wilshire','one',2600,'seed'),
  ('Mid-Wilshire','two',3400,'seed'),('Mid-Wilshire','three',4500,'seed'),
  ('Culver City','studio',2400,'seed'),('Culver City','one',3100,'seed'),
  ('Culver City','two',4000,'seed'),('Culver City','three',5300,'seed'),
  ('Mar Vista','studio',2300,'seed'),('Mar Vista','one',2950,'seed'),
  ('Mar Vista','two',3800,'seed'),('Mar Vista','three',5000,'seed'),
  ('West Adams','studio',1900,'seed'),('West Adams','one',2450,'seed'),
  ('West Adams','two',3100,'seed'),('West Adams','three',4100,'seed'),
  ('Boyle Heights','studio',1600,'seed'),('Boyle Heights','one',2050,'seed'),
  ('Boyle Heights','two',2700,'seed'),('Boyle Heights','three',3500,'seed');

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: sold comps (10 real-ish LA transactions)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO sold_comps (address, neighborhood, zip, lat, lng, project_type, units, avg_unit_sf, sale_price, sale_date, cap_rate, noi, price_per_unit, source, notes) VALUES
  ('3421 Sunset Blvd','Silver Lake','90026',34.0839,-118.2703,'Multifamily',10,820,4200000,'2024-08-15',0.0428,179760,420000,'broker','Value-add 10-unit, 1960s vintage'),
  ('1240 S Harvard Blvd','Koreatown','90006',34.0586,-118.3006,'Multifamily',18,680,5850000,'2024-06-20',0.0452,264420,325000,'broker','R4 zone, fully occupied at time of sale'),
  ('4810 York Blvd','Highland Park','90042',34.1084,-118.2042,'Mixed-Use',8,1100,3100000,'2024-09-30',0.0461,142960,387500,'broker','Ground-floor retail + 7 residential'),
  ('6220 W 3rd St','Mid-Wilshire','90036',34.0626,-118.3404,'Multifamily',24,740,8400000,'2024-07-10',0.0445,373800,350000,'broker','1970s vintage, below-market rents'),
  ('2890 Rowena Ave','Silver Lake','90039',34.0839,-118.2703,'Condo/TH',6,1450,3900000,'2024-10-05',0.0415,161850,650000,'broker','New construction TH, strong finishes'),
  ('5540 W Adams Blvd','West Adams','90016',34.0139,-118.3338,'Multifamily',12,760,3600000,'2024-05-18',0.0472,169920,300000,'broker','TOD site, Metro E-line proximity'),
  ('1650 Griffith Park Blvd','Silver Lake','90026',34.0839,-118.2703,'Multifamily',14,790,6200000,'2024-11-02',0.0438,271560,442857,'costar','R3 zone, full renovation completed'),
  ('4250 Fountain Ave','Los Feliz','90029',34.1019,-118.2923,'Multifamily',9,910,3850000,'2024-04-22',0.0402,154770,427778,'broker','Character building, low turnover'),
  ('820 S Hoover St','Koreatown','90005',34.0586,-118.3006,'Multifamily',20,700,5400000,'2024-08-08',0.0488,263520,270000,'broker','High occupancy, R4 zone'),
  ('6800 Melrose Ave','Mid-Wilshire','90038',34.0626,-118.3404,'Mixed-Use',15,880,6100000,'2024-03-14',0.0451,275110,406667,'costar','C2 zone, mixed ground-floor commercial');

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: 27 development sites
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO sites (address, neighborhood, zip, zoning, lot_sf, project_type, units, avg_unit_sf, price, rti, has_demo, unit_mix, data_source, is_comp) VALUES
  ('2847 Sunset Blvd','Silver Lake','90026','R3',6250,'Multifamily',12,780,1850000,true,true,'{"studio":0.25,"one":0.5,"two":0.2,"three":0.05}','seed',false),
  ('4120 W 3rd St','Koreatown','90020','R4',9800,'Multifamily',24,720,2400000,false,false,'{"studio":0.3,"one":0.45,"two":0.2,"three":0.05}','seed',false),
  ('5634 Monte Vista St','Highland Park','90042','R2',5400,'SFR+ADU',3,1100,880000,false,true,'{"studio":0,"one":0.33,"two":0.34,"three":0.33}','seed',false),
  ('1921 Glendale Blvd','Echo Park','90026','C2',8500,'Mixed-Use',18,850,3100000,true,true,'{"studio":0.2,"one":0.4,"two":0.3,"three":0.1}','seed',false),
  ('3388 Crenshaw Blvd','West Adams','90016','R3',7200,'Multifamily',14,760,1650000,false,false,'{"studio":0.25,"one":0.5,"two":0.2,"three":0.05}','seed',false),
  ('6712 Washington Blvd','Culver City','90232','R3',10200,'Condo/TH',8,1400,2750000,true,true,'{"studio":0,"one":0.25,"two":0.5,"three":0.25}','seed',false),
  ('4455 Fountain Ave','Los Feliz','90029','RD1.5',7800,'Multifamily',10,900,2100000,false,true,'{"studio":0.2,"one":0.4,"two":0.3,"three":0.1}','seed',false),
  ('1102 S Hoover St','Koreatown','90006','R4',8400,'Multifamily',20,700,1950000,true,false,'{"studio":0.35,"one":0.45,"two":0.15,"three":0.05}','seed',false),
  ('5901 Venice Blvd','Mar Vista','90291','C2',9600,'Mixed-Use',16,920,3400000,false,true,'{"studio":0.15,"one":0.45,"two":0.3,"three":0.1}','seed',false),
  ('3214 N Figueroa St','Highland Park','90065','R3',6000,'Multifamily',8,800,1200000,true,true,'{"studio":0.25,"one":0.5,"two":0.25,"three":0}','seed',false),
  ('2250 W Olympic Blvd','Mid-Wilshire','90006','R4',14000,'Multifamily',36,750,4200000,true,false,'{"studio":0.3,"one":0.4,"two":0.2,"three":0.1}','seed',false),
  ('1840 Cesar Chavez Ave','Boyle Heights','90033','R3',5800,'Multifamily',10,760,980000,false,true,'{"studio":0.2,"one":0.5,"two":0.25,"three":0.05}','seed',false),
  ('4622 Prospect Ave','Los Feliz','90027','R3',8800,'Condo/TH',6,1600,2300000,true,true,'{"studio":0,"one":0.17,"two":0.5,"three":0.33}','seed',false),
  ('3755 S La Cienega Blvd','Culver City','90016','C4',18000,'Mixed-Use',48,820,5800000,false,true,'{"studio":0.25,"one":0.45,"two":0.25,"three":0.05}','seed',false),
  ('2100 W Silver Lake Dr','Silver Lake','90039','R2',8200,'SFR+ADU',4,1250,1100000,false,true,'{"studio":0,"one":0.25,"two":0.5,"three":0.25}','seed',false),
  ('4890 W Adams Blvd','West Adams','90016','R3',6800,'Multifamily',12,770,1400000,true,false,'{"studio":0.25,"one":0.45,"two":0.25,"three":0.05}','seed',false),
  ('2780 Virgil Ave','Echo Park','90029','R3',6400,'Multifamily',9,840,1580000,false,true,'{"studio":0.22,"one":0.45,"two":0.22,"three":0.11}','seed',false),
  ('6340 Brynhurst Ave','Mar Vista','90043','RD1.5',9000,'Condo/TH',5,1500,2050000,true,true,'{"studio":0,"one":0.2,"two":0.6,"three":0.2}','seed',false),
  ('7200 Melrose Ave','Mid-Wilshire','90046','[Q]C2',16500,'Mixed-Use',42,880,6200000,true,true,'{"studio":0.25,"one":0.42,"two":0.25,"three":0.08}','seed',false),
  ('3040 Leeward Ave','Koreatown','90006','R4',9200,'Multifamily',22,740,2100000,false,false,'{"studio":0.3,"one":0.45,"two":0.2,"three":0.05}','seed',false),
  ('915 N Ave 52','Highland Park','90042','R2',5000,'SFR+ADU',3,1050,750000,true,false,'{"studio":0,"one":0.33,"two":0.34,"three":0.33}','seed',false),
  ('1645 Griffith Park Blvd','Silver Lake','90026','R3',7400,'Multifamily',14,800,2200000,false,true,'{"studio":0.22,"one":0.48,"two":0.22,"three":0.08}','seed',false),
  ('3100 Sunset Blvd','Silver Lake','90026','R3',7200,'Multifamily',14,800,NULL,false,true,'{"studio":0.25,"one":0.5,"two":0.2,"three":0.05}','seed',true),
  ('880 N Vermont Ave','Los Feliz','90029','C2',9400,'Mixed-Use',20,870,NULL,false,true,'{"studio":0.2,"one":0.42,"two":0.28,"three":0.1}','seed',true),
  ('5200 York Blvd','Highland Park','90042','R3',6100,'Multifamily',9,790,NULL,false,false,'{"studio":0.25,"one":0.5,"two":0.25,"three":0}','seed',true),
  ('1320 S Hoover St','Koreatown','90006','R4',8800,'Multifamily',22,710,NULL,false,false,'{"studio":0.3,"one":0.45,"two":0.2,"three":0.05}','seed',true),
  ('4100 Crenshaw Blvd','West Adams','90016','R3',7500,'Multifamily',13,760,NULL,true,false,'{"studio":0.25,"one":0.5,"two":0.2,"three":0.05}','seed',true);
