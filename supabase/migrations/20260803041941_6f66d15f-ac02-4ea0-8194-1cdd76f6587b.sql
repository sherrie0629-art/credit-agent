CREATE TABLE public.advisor_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE,
  trigger_source TEXT NOT NULL DEFAULT 'MANUAL',
  ok BOOLEAN NOT NULL DEFAULT true,
  model TEXT,
  duration_ms INTEGER,
  raw_output TEXT,
  suggestions_raw INTEGER NOT NULL DEFAULT 0,
  suggestions_kept INTEGER NOT NULL DEFAULT 0,
  dropped JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT
);

GRANT ALL ON public.advisor_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.advisor_runs_id_seq TO service_role;

ALTER TABLE public.advisor_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advisor_runs service only" ON public.advisor_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX advisor_runs_started_at_idx ON public.advisor_runs (started_at DESC);