ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS kill_switch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_budget_delta_pct numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS max_daily_budget_delta_pct numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS max_ad_group_daily_budget numeric NOT NULL DEFAULT 20000,
  ADD COLUMN IF NOT EXISTS max_actions_per_hour integer NOT NULL DEFAULT 20;

ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS trigger_source text NOT NULL DEFAULT 'EVENT',
  ADD COLUMN IF NOT EXISTS guardrail_note text;

CREATE TABLE IF NOT EXISTS public.guardrail_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  target_id text NOT NULL DEFAULT '',
  rule text NOT NULL,
  verdict text NOT NULL,
  detail text NOT NULL DEFAULT '',
  requested jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT ALL ON public.guardrail_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.guardrail_events_id_seq TO service_role;
ALTER TABLE public.guardrail_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guardrail_events service only" ON public.guardrail_events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.sweep_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean NOT NULL DEFAULT false,
  fatigue_alerts integer NOT NULL DEFAULT 0,
  risk_pauses integer NOT NULL DEFAULT 0,
  experiments_settled integer NOT NULL DEFAULT 0,
  pace_breaches integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT ALL ON public.sweep_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sweep_runs_id_seq TO service_role;
ALTER TABLE public.sweep_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sweep_runs service only" ON public.sweep_runs FOR ALL TO service_role USING (true) WITH CHECK (true);