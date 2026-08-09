-- Google → Agent structure sync: origin tagging + soft-removed flag.
-- Demo rows are backfilled as origin=demo and never deleted by sync.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'demo',
  ADD COLUMN IF NOT EXISTS google_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS platform_removed boolean NOT NULL DEFAULT false;

ALTER TABLE public.ad_groups
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'demo',
  ADD COLUMN IF NOT EXISTS google_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS platform_removed boolean NOT NULL DEFAULT false;

ALTER TABLE public.creative_assets
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'demo',
  ADD COLUMN IF NOT EXISTS google_resource_name text,
  ADD COLUMN IF NOT EXISTS google_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS platform_removed boolean NOT NULL DEFAULT false;

-- Existing seed / mock rows stay demo (default already demo).
UPDATE public.campaigns
SET origin = 'demo'
WHERE origin IS NULL OR origin = '' OR id NOT LIKE 'g_cmp_%';

UPDATE public.ad_groups
SET origin = 'demo'
WHERE origin IS NULL OR origin = '' OR id NOT LIKE 'g_adg_%';

UPDATE public.creative_assets
SET origin = 'demo'
WHERE origin IS NULL OR origin = '' OR id NOT LIKE 'g_ad_%';

COMMENT ON COLUMN public.campaigns.origin IS 'demo | google_sync';
COMMENT ON COLUMN public.ad_groups.origin IS 'demo | google_sync';
COMMENT ON COLUMN public.creative_assets.origin IS 'demo | google_sync';
COMMENT ON COLUMN public.campaigns.platform_removed IS
  'True when last Google structure sync no longer saw this resource';

CREATE TABLE IF NOT EXISTS public.google_structure_sync_runs (
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

GRANT ALL ON public.google_structure_sync_runs TO service_role;
ALTER TABLE public.google_structure_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "google_structure_sync_runs service only"
  ON public.google_structure_sync_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
