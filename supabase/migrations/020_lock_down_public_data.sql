-- Route all ParcelLA application data through the authenticated API. The API
-- uses the Supabase service role; browser clients use Supabase only for Auth.

BEGIN;

DO $$
DECLARE
  table_name TEXT;
  protected_tables CONSTANT TEXT[] := ARRAY[
    'sites',
    'profiles',
    'saved_sites',
    'deal_notes',
    'model_overrides',
    'alerts',
    'rent_comps',
    'sold_comps',
    'permits',
    'share_links',
    'narratives',
    'activity_log',
    'subscription_events',
    'sync_log',
    'property_enrichment_cache',
    'planning_cases',
    'planning_documents',
    'site_planning_cases',
    'planning_sync_state',
    'terms_acceptances'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        table_name
      );
      EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END $$;

-- Remove the original broad policies as defense in depth. The privilege
-- revocations above protect deployments where additional policies exist.
DROP POLICY IF EXISTS "Sites public read" ON public.sites;
DROP POLICY IF EXISTS "Rent comps public read" ON public.rent_comps;
DROP POLICY IF EXISTS "Sold comps public read" ON public.sold_comps;
DROP POLICY IF EXISTS "Permits public read" ON public.permits;
DROP POLICY IF EXISTS "Share links public read" ON public.share_links;
DROP POLICY IF EXISTS "Narratives public read" ON public.narratives;
DROP POLICY IF EXISTS "Auth can insert sites" ON public.sites;
DROP POLICY IF EXISTS "Auth can insert sold" ON public.sold_comps;

DO $$
DECLARE
  view_name TEXT;
BEGIN
  FOREACH view_name IN ARRAY ARRAY['rti_sites', 'submarket_cap_rates'] LOOP
    IF to_regclass(format('public.%I', view_name)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        view_name
      );
      EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', view_name);
    END IF;
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

COMMIT;
