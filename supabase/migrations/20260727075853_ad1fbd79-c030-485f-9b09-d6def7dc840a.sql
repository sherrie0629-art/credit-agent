DROP POLICY IF EXISTS creative_experiments_public_read ON public.creative_experiments;
DROP POLICY IF EXISTS creative_metrics_public_read ON public.creative_metrics;
DROP POLICY IF EXISTS creative_variants_public_read ON public.creative_variants;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_decisions','agent_settings','campaigns','creative_assets','creative_experiments','creative_metrics','creative_variants','funnel_stages','channel_trend','channel_breakdown']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;