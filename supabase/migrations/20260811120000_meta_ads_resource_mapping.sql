-- Meta → Agent structure sync: resource columns + meta_sync origin + sync runs.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS meta_resource_name text,
  ADD COLUMN IF NOT EXISTS meta_sync_at timestamptz;

ALTER TABLE public.ad_groups
  ADD COLUMN IF NOT EXISTS meta_resource_name text,
  ADD COLUMN IF NOT EXISTS meta_sync_at timestamptz;

ALTER TABLE public.creative_assets
  ADD COLUMN IF NOT EXISTS meta_resource_name text,
  ADD COLUMN IF NOT EXISTS meta_sync_at timestamptz;

COMMENT ON COLUMN public.campaigns.origin IS 'demo | google_sync | meta_sync';
COMMENT ON COLUMN public.ad_groups.origin IS 'demo | google_sync | meta_sync';
COMMENT ON COLUMN public.creative_assets.origin IS 'demo | google_sync | meta_sync';

COMMENT ON COLUMN public.campaigns.meta_resource_name IS 'Meta Campaign id (numeric string)';
COMMENT ON COLUMN public.ad_groups.meta_resource_name IS 'Meta Ad Set id — budget/status push target';
COMMENT ON COLUMN public.creative_assets.meta_resource_name IS 'Meta Ad id';

CREATE TABLE IF NOT EXISTS public.meta_structure_sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean NOT NULL DEFAULT false,
  campaigns_upserted integer NOT NULL DEFAULT 0,
  ad_groups_upserted integer NOT NULL DEFAULT 0,
  creatives_upserted integer NOT NULL DEFAULT 0,
  marked_removed integer NOT NULL DEFAULT 0,
  error text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT ALL ON public.meta_structure_sync_runs TO service_role;
ALTER TABLE public.meta_structure_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meta_structure_sync_runs service only"
  ON public.meta_structure_sync_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
