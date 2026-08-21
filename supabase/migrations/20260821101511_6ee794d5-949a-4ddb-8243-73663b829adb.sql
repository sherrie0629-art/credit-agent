
CREATE TABLE IF NOT EXISTS public.audience_segments (
  id text PRIMARY KEY,
  channel text NOT NULL,
  name text NOT NULL,
  platform_resource_name text,
  targeting_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin text NOT NULL DEFAULT 'demo',
  synced_at timestamptz,
  platform_removed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.audience_segments TO service_role;
ALTER TABLE public.audience_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audience_segments service only" ON public.audience_segments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.audience_segment_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id text NOT NULL REFERENCES public.audience_segments(id) ON DELETE CASCADE,
  expected_cvr numeric,
  expected_disb_rate numeric,
  sample_size integer NOT NULL DEFAULT 0,
  maturity numeric,
  window_from timestamptz,
  window_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audience_segment_facts_segment_idx ON public.audience_segment_facts(segment_id);
GRANT ALL ON public.audience_segment_facts TO service_role;
ALTER TABLE public.audience_segment_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audience_segment_facts service only" ON public.audience_segment_facts FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.ad_groups ADD COLUMN IF NOT EXISTS audience_segment_id text REFERENCES public.audience_segments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ad_groups_audience_segment_idx ON public.ad_groups(audience_segment_id);
