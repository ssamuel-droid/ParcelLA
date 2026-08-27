-- Keep dashboard paging on indexed lookups. The sites table is dominated by
-- New House permit rows, while the default dashboard asks for the highest-
-- return apartment/condo records. Composite indexes prevent PostgreSQL from
-- scanning the house-heavy table before it can return the first 20 cards.

CREATE INDEX IF NOT EXISTS sites_dashboard_profit_idx
  ON sites (project_type, status, net_profit DESC, id DESC)
  WHERE net_profit IS NOT NULL;

CREATE INDEX IF NOT EXISTS sites_dashboard_irr_idx
  ON sites (project_type, status, irr_v DESC, id DESC)
  WHERE net_profit IS NOT NULL;

CREATE INDEX IF NOT EXISTS sites_dashboard_spread_idx
  ON sites (project_type, status, dev_spread_pct DESC, id DESC)
  WHERE net_profit IS NOT NULL;

CREATE INDEX IF NOT EXISTS sites_dashboard_capoc_idx
  ON sites (project_type, status, cap_on_cost DESC, id DESC)
  WHERE net_profit IS NOT NULL;

CREATE INDEX IF NOT EXISTS sites_dashboard_price_idx
  ON sites (project_type, status, price DESC, id DESC)
  WHERE net_profit IS NOT NULL;

CREATE INDEX IF NOT EXISTS sites_dashboard_units_idx
  ON sites (project_type, status, units DESC, id DESC)
  WHERE net_profit IS NOT NULL;
