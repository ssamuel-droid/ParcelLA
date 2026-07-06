-- Add public-record fields for county recorder / assessor sale comp imports.

ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS apn TEXT;
ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS recorder_document_number TEXT;
ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS document_type TEXT;
ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS transfer_tax NUMERIC;
ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS sale_price_confidence TEXT;
ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS sale_price_method TEXT;
ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS raw_record JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS sold_comps_recorder_document_number_uidx
  ON sold_comps(recorder_document_number);

CREATE INDEX IF NOT EXISTS sold_comps_apn_idx
  ON sold_comps(apn);
