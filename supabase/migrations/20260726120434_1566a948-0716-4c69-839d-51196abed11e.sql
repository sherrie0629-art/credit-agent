-- 1. creative_metrics
CREATE TABLE public.creative_metrics (
  id BIGSERIAL PRIMARY KEY,
  creative_id TEXT NOT NULL,
  day DATE NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr NUMERIC NOT NULL DEFAULT 0,
  cpl NUMERIC NOT NULL DEFAULT 0,
  cps NUMERIC NOT NULL DEFAULT 0,
  frequency NUMERIC NOT NULL DEFAULT 0,
  spend NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (creative_id, day)
);
GRANT SELECT ON public.creative_metrics TO anon, authenticated;
GRANT ALL ON public.creative_metrics TO service_role;
ALTER TABLE public.creative_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creative_metrics_public_read" ON public.creative_metrics FOR SELECT TO anon, authenticated USING (true);

-- 2. creative_experiments
CREATE TABLE public.creative_experiments (
  id TEXT PRIMARY KEY,
  parent_creative_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  winner_variant_id TEXT,
  arm_stats JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.creative_experiments TO anon, authenticated;
GRANT ALL ON public.creative_experiments TO service_role;
ALTER TABLE public.creative_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creative_experiments_public_read" ON public.creative_experiments FOR SELECT TO anon, authenticated USING (true);

-- 3. creative_variants
CREATE TABLE public.creative_variants (
  id TEXT PRIMARY KEY,
  parent_creative_id TEXT NOT NULL,
  experiment_id TEXT REFERENCES public.creative_experiments(id) ON DELETE SET NULL,
  headline TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  angle TEXT NOT NULL DEFAULT '',
  compliance_status TEXT NOT NULL DEFAULT 'WARNING',
  compliance_score NUMERIC NOT NULL DEFAULT 0,
  compliance_logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.creative_variants TO anon, authenticated;
GRANT ALL ON public.creative_variants TO service_role;
ALTER TABLE public.creative_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creative_variants_public_read" ON public.creative_variants FOR SELECT TO anon, authenticated USING (true);

-- 4. creative_assets extra columns
ALTER TABLE public.creative_assets
  ADD COLUMN IF NOT EXISTS fatigue_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fatigue_level TEXT NOT NULL DEFAULT 'HEALTHY',
  ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ NOT NULL DEFAULT now() - INTERVAL '14 days',
  ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;

-- 5. seed 14 days of metrics
INSERT INTO public.creative_metrics (creative_id, day, impressions, clicks, ctr, cpl, cps, frequency, spend)
SELECT 'crv_reels_88',
       (CURRENT_DATE - (13 - i))::date,
       (14000 + i * 900)::bigint,
       round((14000 + i * 900) * (0.045 - i * 0.0024))::bigint,
       round((0.045 - i * 0.0024)::numeric, 4),
       round((12.4 + i * 1.15)::numeric, 2),
       round((21.5 + i * 1.9)::numeric, 2),
       round((1.2 + i * 0.26)::numeric, 2),
       round((880 + i * 42)::numeric, 2)
FROM generate_series(0, 13) AS i;

INSERT INTO public.creative_metrics (creative_id, day, impressions, clicks, ctr, cpl, cps, frequency, spend)
SELECT 'crv_m_02',
       (CURRENT_DATE - (13 - i))::date,
       (11000 + i * 400)::bigint,
       round((11000 + i * 400) * (0.038 - i * 0.0008))::bigint,
       round((0.038 - i * 0.0008)::numeric, 4),
       round((14.2 + i * 0.32)::numeric, 2),
       round((19.8 + i * 0.4)::numeric, 2),
       round((1.1 + i * 0.16)::numeric, 2),
       round((640 + i * 18)::numeric, 2)
FROM generate_series(0, 13) AS i;

INSERT INTO public.creative_metrics (creative_id, day, impressions, clicks, ctr, cpl, cps, frequency, spend)
SELECT 'crv_g_01',
       (CURRENT_DATE - (13 - i))::date,
       (9200 + i * 260)::bigint,
       round((9200 + i * 260) * (0.031 + i * 0.00016))::bigint,
       round((0.031 + i * 0.00016)::numeric, 4),
       round((15.1 - i * 0.06)::numeric, 2),
       round((18.4 - i * 0.05)::numeric, 2),
       round((1.0 + i * 0.07)::numeric, 2),
       round((520 + i * 11)::numeric, 2)
FROM generate_series(0, 13) AS i;

-- 6. updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_creative_variants_updated_at BEFORE UPDATE ON public.creative_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_creative_experiments_updated_at BEFORE UPDATE ON public.creative_experiments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();