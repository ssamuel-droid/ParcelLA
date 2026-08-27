-- Extract frequently filtered permit details from raw_data so New House searches
-- can be answered with indexed database filters instead of scanning JSON in Node.

ALTER TABLE permits ADD COLUMN IF NOT EXISTS building_sf INTEGER;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS building_sf_source TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS building_sf_parsed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS stories NUMERIC;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS contractor_name TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS contractor_address TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS contractor_city TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS contractor_state TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS applicant_name TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS applicant_business_name TEXT;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS project_detail_complete BOOLEAN NOT NULL DEFAULT FALSE;

-- Earlier partial runs may have created these columns before their defaults and
-- constraints were finalized. Normalize them so this migration is safe to rerun.
ALTER TABLE permits ALTER COLUMN building_sf_parsed SET DEFAULT FALSE;
ALTER TABLE permits ALTER COLUMN project_detail_complete SET DEFAULT FALSE;
UPDATE permits SET building_sf_parsed = FALSE WHERE building_sf_parsed IS NULL;
UPDATE permits SET project_detail_complete = FALSE WHERE project_detail_complete IS NULL;
ALTER TABLE permits ALTER COLUMN building_sf_parsed SET NOT NULL;
ALTER TABLE permits ALTER COLUMN project_detail_complete SET NOT NULL;

CREATE OR REPLACE FUNCTION public.parcella_first_number(value TEXT)
RETURNS NUMERIC
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    REPLACE(SUBSTRING(value FROM '([0-9][0-9,]*(?:\.[0-9]+)?)'), ',', ''),
    ''
  )::NUMERIC;
$$;

CREATE OR REPLACE FUNCTION public.parcella_sqft_from_text(value TEXT)
RETURNS NUMERIC
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    REPLACE(
      (REGEXP_MATCH(value, '([0-9][0-9,]{2,})\s*(?:sq\.?\s*ft|square\s*feet|s\.?f\.?|sf)', 'i'))[1],
      ',',
      ''
    ),
    ''
  )::NUMERIC;
$$;

CREATE OR REPLACE FUNCTION public.parcella_stories_from_text(value TEXT)
RETURNS NUMERIC
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    public.parcella_first_number(
      (REGEXP_MATCH(value, '([0-9]+(?:\.[0-9]+)?)\s*[- ]?\s*stor(?:y|ies)', 'i'))[1]
    ),
    CASE LOWER((REGEXP_MATCH(value, '(one|two|three|four|five)\s*[- ]?\s*stor(?:y|ies)', 'i'))[1])
      WHEN 'one' THEN 1
      WHEN 'two' THEN 2
      WHEN 'three' THEN 3
      WHEN 'four' THEN 4
      WHEN 'five' THEN 5
      ELSE NULL
    END
  );
$$;

WITH source_values AS (
  SELECT
    id,
    COALESCE(
      public.parcella_first_number(raw_data->>'floor_area_l_a_building_code_definition'),
      public.parcella_first_number(raw_data->>'floor_area_l_a_zoning_code_definition'),
      public.parcella_first_number(raw_data->>'floor_area'),
      public.parcella_first_number(raw_data->>'floorarea'),
      public.parcella_first_number(raw_data->>'building_area'),
      public.parcella_first_number(raw_data->>'building_sf'),
      public.parcella_first_number(raw_data->>'total_floor_area'),
      public.parcella_first_number(raw_data->>'new_floor_area'),
      public.parcella_first_number(raw_data->>'proposed_floor_area'),
      public.parcella_first_number(raw_data->>'project_floor_area'),
      public.parcella_first_number(raw_data->>'square_footage'),
      public.parcella_first_number(raw_data->>'sqft'),
      public.parcella_first_number(raw_data->>'gross_floor_area'),
      public.parcella_first_number(raw_data->>'gross_building_area'),
      public.parcella_first_number(raw_data->>'residential_floor_area')
    ) AS direct_sf,
    public.parcella_sqft_from_text(COALESCE(
      work_description,
      raw_data->>'work_description',
      raw_data->>'work_desc',
      raw_data->>'project_description',
      raw_data->>'description'
    )) AS text_sf,
    COALESCE(
      public.parcella_first_number(raw_data->>'of_stories'),
      public.parcella_first_number(raw_data->>'stories'),
      public.parcella_first_number(raw_data->>'number_of_stories'),
      public.parcella_first_number(raw_data->>'story_count'),
      public.parcella_stories_from_text(COALESCE(
        work_description,
        raw_data->>'work_description',
        raw_data->>'work_desc',
        raw_data->>'project_description',
        raw_data->>'description'
      ))
    ) AS story_count
  FROM permits
), derived AS (
  SELECT
    id,
    COALESCE(text_sf, direct_sf) AS derived_sf,
    CASE
      WHEN text_sf IS NOT NULL THEN 'Permit work description'
      WHEN direct_sf IS NOT NULL THEN 'Permit source field'
      ELSE NULL
    END AS derived_sf_source,
    story_count
  FROM source_values
)
UPDATE permits AS p
SET
  work_description = COALESCE(
    p.work_description,
    p.raw_data->>'work_description',
    p.raw_data->>'work_desc',
    p.raw_data->>'project_description',
    p.raw_data->>'description'
  ),
  valuation = COALESCE(p.valuation, public.parcella_first_number(p.raw_data->>'valuation')),
  units = COALESCE(
    p.units,
    public.parcella_first_number(p.raw_data->>'of_residential_dwelling_units')::INTEGER,
    public.parcella_first_number(p.raw_data->>'number_of_units')::INTEGER,
    public.parcella_first_number(p.raw_data->>'numberofunits')::INTEGER,
    public.parcella_first_number(p.raw_data->>'du_changed')::INTEGER
  ),
  building_sf = CASE
    WHEN d.derived_sf BETWEEN 300 AND 5000000 THEN ROUND(d.derived_sf)::INTEGER
    ELSE NULL
  END,
  building_sf_source = CASE
    WHEN d.derived_sf BETWEEN 300 AND 5000000 THEN d.derived_sf_source
    ELSE NULL
  END,
  building_sf_parsed = COALESCE(d.derived_sf BETWEEN 300 AND 5000000, FALSE),
  stories = CASE WHEN d.story_count BETWEEN 1 AND 200 THEN d.story_count ELSE NULL END,
  contractor_name = COALESCE(
    p.raw_data->>'contractor_name',
    p.raw_data->>'contractors_business_name',
    p.raw_data->>'contractor_business_name'
  ),
  contractor_address = p.raw_data->>'contractor_address',
  contractor_city = p.raw_data->>'contractor_city',
  contractor_state = p.raw_data->>'contractor_state',
  applicant_name = COALESCE(
    p.raw_data->>'applicant_name',
    p.raw_data->>'applicantName',
    p.raw_data->>'applicant',
    NULLIF(CONCAT_WS(' ', p.raw_data->>'applicant_first_name', p.raw_data->>'applicant_last_name'), '')
  ),
  applicant_business_name = p.raw_data->>'applicant_business_name'
FROM derived AS d
WHERE p.id = d.id;

UPDATE permits
SET project_detail_complete = (
  building_sf IS NOT NULL
  AND COALESCE(building_sf_parsed, FALSE)
  AND LENGTH(TRIM(COALESCE(work_description, ''))) >= 12
  AND COALESCE(valuation, 0) > 0
  AND (
    COALESCE(units, 0) > 0
    OR work_description ~* '(single[- ]family|sfd|one[- ]family|1\s*(dwelling|unit))'
  )
  AND COALESCE(stories, 0) > 0
);

CREATE INDEX IF NOT EXISTS permits_house_sf_idx
  ON permits (building_sf, id DESC)
  WHERE permit_type = 'Bldg-New' AND project_detail_complete;

CREATE INDEX IF NOT EXISTS permits_house_location_idx
  ON permits (lat, lng, id DESC)
  WHERE permit_type = 'Bldg-New' AND project_detail_complete;

CREATE INDEX IF NOT EXISTS permits_house_status_idx
  ON permits (status, is_rti, id DESC)
  WHERE permit_type = 'Bldg-New' AND project_detail_complete;
