-- Log table for sync runs
CREATE TABLE IF NOT EXISTS sync_log (
  id       SERIAL PRIMARY KEY,
  source   TEXT NOT NULL,
  records  INTEGER DEFAULT 0,
  status   TEXT DEFAULT 'ok',
  error    TEXT,
  ran_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Helper: detect RTI from permit status/description
CREATE OR REPLACE FUNCTION is_rti_permit(status TEXT, description TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    lower(coalesce(status,''))      LIKE '%ready to issue%' OR
    lower(coalesce(status,''))      LIKE '%rti%'             OR
    lower(coalesce(status,''))      LIKE '%approved for permit%' OR
    lower(coalesce(description,'')) LIKE '%ready to issue%'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- View: RTI sites joined with latest permit
CREATE OR REPLACE VIEW rti_sites AS
  SELECT s.id, s.address, s.neighborhood, s.zoning, s.units, s.price,
    p.permit_number, p.status AS permit_status, p.issued_date, p.work_description
  FROM sites s
  JOIN permits p ON p.site_id = s.id
  WHERE p.is_rti = true AND s.status = 'active'
  ORDER BY p.issued_date DESC;
