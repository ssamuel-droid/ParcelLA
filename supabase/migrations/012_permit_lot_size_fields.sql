-- Store real permit lot square footage in indexed columns. This keeps New House
-- searches fast and lets the underwriting UI distinguish lot SF from home SF.

ALTER TABLE permits ADD COLUMN IF NOT EXISTS lot_sf INTEGER;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS lot_sf_source TEXT;

CREATE OR REPLACE FUNCTION public.parcella_lot_sqft_from_text(value TEXT)
RETURNS NUMERIC
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    NULLIF(
      REPLACE(
        (REGEXP_MATCH(
          COALESCE(value, ''),
          '(?:lot|site area|parcel|land area|property area)[^0-9]{0,60}([0-9][0-9,]{2,})\s*(?:sq\.?\s*ft|square\s*feet|s\.?f\.?|sf)',
          'i'
        ))[1],
        ',',
        ''
      ),
      ''
    )::NUMERIC,
    NULLIF(
      REPLACE(
        (REGEXP_MATCH(
          COALESCE(value, ''),
          '([0-9][0-9,]{2,})\s*(?:sq\.?\s*ft|square\s*feet|s\.?f\.?|sf)[^a-z0-9]{0,35}(?:lot|site|parcel|land|property)',
          'i'
        ))[1],
        ',',
        ''
      ),
      ''
    )::NUMERIC
  );
$$;

WITH lot_values AS (
  SELECT
    id,
    COALESCE(
      lot_sf::NUMERIC,
      public.parcella_first_number(raw_data->>'lot_area'),
      public.parcella_first_number(raw_data->>'lot_sf'),
      public.parcella_first_number(raw_data->>'lot_size'),
      public.parcella_first_number(raw_data->>'lot_square_footage'),
      public.parcella_first_number(raw_data->>'lot_sqft'),
      public.parcella_first_number(raw_data->>'site_area'),
      public.parcella_first_number(raw_data->>'parcel_area')
    ) AS direct_lot_sf,
    public.parcella_lot_sqft_from_text(CONCAT_WS(
      ' ',
      work_description,
      raw_data->>'work_description',
      raw_data->>'work_desc',
      raw_data->>'project_description',
      raw_data->>'description'
    )) AS text_lot_sf
  FROM permits
)
UPDATE permits AS p
SET
  lot_sf = CASE
    WHEN COALESCE(v.direct_lot_sf, v.text_lot_sf) BETWEEN 1000 AND 2000000
      THEN ROUND(COALESCE(v.direct_lot_sf, v.text_lot_sf))::INTEGER
    ELSE NULL
  END,
  lot_sf_source = CASE
    WHEN v.direct_lot_sf BETWEEN 1000 AND 2000000 THEN COALESCE(p.lot_sf_source, 'Permit source field')
    WHEN v.text_lot_sf BETWEEN 1000 AND 2000000 THEN 'Permit work description'
    ELSE NULL
  END
FROM lot_values AS v
WHERE p.id = v.id;

CREATE INDEX IF NOT EXISTS permits_house_lot_sf_idx
  ON permits (lot_sf, id DESC)
  WHERE permit_type = 'Bldg-New' AND project_detail_complete;
