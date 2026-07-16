-- Replace the old SFR+ADU bucket with New House.
-- True ADU/accessory/addition permits are excluded upstream before underwriting.

ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_project_type_check;

UPDATE sites
SET project_type = 'New House'
WHERE project_type = 'SFR+ADU';

ALTER TABLE sites
ADD CONSTRAINT sites_project_type_check
CHECK (project_type IN ('Multifamily','Mixed-Use','Condo/TH','New House'));
