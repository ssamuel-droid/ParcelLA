-- Optional owner/sale cache fields.
-- The app can still live-lookup owner/sale data without these columns, but adding
-- them lets a nightly enrichment job persist owner, date sold, and sale price.

ALTER TABLE sites ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS owner_last_sale_date DATE;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS owner_last_sale_amount BIGINT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS owner_source TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS owner_enriched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sites_owner_name_trgm
  ON sites USING GIN(owner_name gin_trgm_ops);
