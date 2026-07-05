-- Add optional property-level detail fields for rent and sales comp reporting.

ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS property_name TEXT;
ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS lat NUMERIC(10,6);
ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS lng NUMERIC(10,6);
ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS units INTEGER;
ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS avg_unit_sf INTEGER;
ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS year_built INTEGER;
ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS amenities TEXT;
ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS property_url TEXT;
ALTER TABLE rent_comps ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS year_built INTEGER;
ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS amenities TEXT;
