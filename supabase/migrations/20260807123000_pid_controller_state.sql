-- Per-ad-group discrete PID controller state for CPS-tracking budget suggestions.
CREATE TABLE IF NOT EXISTS public.pid_controller_state (
  ad_group_id text PRIMARY KEY REFERENCES public.ad_groups(id) ON DELETE CASCADE,
  integral numeric NOT NULL DEFAULT 0,
  last_error numeric NOT NULL DEFAULT 0,
  last_output numeric NOT NULL DEFAULT 0,
  last_cps numeric NOT NULL DEFAULT 0,
  last_suggestion_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.pid_controller_state TO service_role;
ALTER TABLE public.pid_controller_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pid_controller_state service only" ON public.pid_controller_state;
CREATE POLICY "pid_controller_state service only"
  ON public.pid_controller_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);
