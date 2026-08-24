-- Monthly external property-data cache.
-- Run this once before enabling the monthly enrichment workflow.

CREATE TABLE IF NOT EXISTS property_enrichment_cache (
  id BIGSERIAL PRIMARY KEY,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'ok',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  request_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  UNIQUE(provider, purpose, cache_key)
);

CREATE INDEX IF NOT EXISTS property_enrichment_cache_site_idx
  ON property_enrichment_cache(site_id);

CREATE INDEX IF NOT EXISTS property_enrichment_cache_provider_purpose_idx
  ON property_enrichment_cache(provider, purpose);

CREATE INDEX IF NOT EXISTS property_enrichment_cache_expires_idx
  ON property_enrichment_cache(expires_at);

ALTER TABLE property_enrichment_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS external_enriched_at TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS external_data_sources TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE sites ADD COLUMN IF NOT EXISTS data_quality JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS rentcast_enriched_at TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS regrid_enriched_at TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS external_property_record JSONB;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS external_rent_estimate JSONB;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS external_value_estimate JSONB;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS external_rent_comps JSONB;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS external_sale_comps JSONB;

CREATE INDEX IF NOT EXISTS sites_external_enriched_at_idx
  ON sites(external_enriched_at);

CREATE INDEX IF NOT EXISTS sites_rentcast_enriched_at_idx
  ON sites(rentcast_enriched_at);
