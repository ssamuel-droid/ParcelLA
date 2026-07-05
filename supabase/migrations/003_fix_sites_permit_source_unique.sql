-- Supabase REST upsert needs a plain unique index for on_conflict=permit_source_id.
-- This is safe to run even if the earlier underwriting migration was missed.

ALTER TABLE sites ADD COLUMN IF NOT EXISTS estimated_units BOOLEAN DEFAULT FALSE;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS noi BIGINT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS total_cost BIGINT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS exit_value BIGINT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS net_profit BIGINT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS irr_v NUMERIC(8,2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS cap_on_cost NUMERIC(8,2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS dev_spread_pct NUMERIC(8,2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS permit_source_id TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS underwritten_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sites_irr_idx ON sites(irr_v DESC);
CREATE INDEX IF NOT EXISTS sites_profit_idx ON sites(net_profit DESC);

DROP INDEX IF EXISTS sites_permit_source_uidx;
CREATE UNIQUE INDEX sites_permit_source_uidx ON sites(permit_source_id);
