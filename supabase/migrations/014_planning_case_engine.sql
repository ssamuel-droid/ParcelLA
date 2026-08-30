-- Automated City Planning case and PDIS document discovery.
-- Run once in Supabase before enabling sync-planning-cases.yml.

CREATE TABLE IF NOT EXISTS planning_cases (
  case_number TEXT PRIMARY KEY,
  case_id BIGINT,
  apn TEXT,
  address TEXT,
  address_normalized TEXT,
  neighborhood_council TEXT,
  community_plan_area TEXT,
  council_district INTEGER,
  project_description TEXT,
  request_type TEXT,
  application_date DATE,
  completion_date DATE,
  case_status TEXT NOT NULL DEFAULT 'filed',
  pdis_url TEXT NOT NULL,
  zimas_pin TEXT,
  zimas_url TEXT,
  case_addresses JSONB NOT NULL DEFAULT '[]'::JSONB,
  related_case_numbers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  source_record JSONB NOT NULL DEFAULT '{}'::JSONB,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  documents_checked_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS planning_documents (
  id BIGSERIAL PRIMARY KEY,
  case_number TEXT NOT NULL REFERENCES planning_cases(case_number) ON DELETE CASCADE,
  provider_document_id TEXT NOT NULL,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'other',
  document_category TEXT,
  section TEXT NOT NULL,
  document_date DATE,
  url TEXT NOT NULL,
  comments TEXT,
  is_approved_plan BOOLEAN,
  source_record JSONB NOT NULL DEFAULT '{}'::JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_number, provider_document_id, section)
);

CREATE TABLE IF NOT EXISTS site_planning_cases (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  case_number TEXT NOT NULL REFERENCES planning_cases(case_number) ON DELETE CASCADE,
  match_method TEXT NOT NULL,
  match_confidence NUMERIC(4,3) NOT NULL DEFAULT 1,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(site_id, case_number)
);

CREATE TABLE IF NOT EXISTS planning_sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  case_count INTEGER NOT NULL DEFAULT 0,
  match_count INTEGER NOT NULL DEFAULT 0,
  document_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO planning_sync_state (id, status)
VALUES (1, 'pending')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS planning_cases_apn_idx ON planning_cases(apn);
CREATE INDEX IF NOT EXISTS planning_cases_address_idx ON planning_cases(address_normalized);
CREATE INDEX IF NOT EXISTS planning_cases_case_id_idx ON planning_cases(case_id);
CREATE INDEX IF NOT EXISTS planning_cases_documents_checked_idx ON planning_cases(documents_checked_at);
CREATE INDEX IF NOT EXISTS planning_documents_case_idx ON planning_documents(case_number, document_date DESC);
CREATE INDEX IF NOT EXISTS site_planning_cases_site_idx ON site_planning_cases(site_id);
CREATE INDEX IF NOT EXISTS site_planning_cases_case_idx ON site_planning_cases(case_number);

ALTER TABLE planning_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_planning_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_sync_state ENABLE ROW LEVEL SECURITY;
