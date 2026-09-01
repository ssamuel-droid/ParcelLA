-- Preserve the full paid-provider property record used for owner and sale history.
ALTER TABLE sold_comps ADD COLUMN IF NOT EXISTS raw_record JSONB;
