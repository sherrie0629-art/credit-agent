CREATE TABLE public.budget_pool_entries (
  id BIGSERIAL PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('RELEASE','ALLOCATE')),
  ad_group_id TEXT NOT NULL DEFAULT '',
  ad_group_name TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'MANUAL',
  decision_id TEXT,
  status TEXT NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('PENDING','APPLIED','REVERTED')),
  note TEXT NOT NULL DEFAULT '',
  pool_day DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.budget_pool_entries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.budget_pool_entries_id_seq TO service_role;

ALTER TABLE public.budget_pool_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_pool_entries service only"
ON public.budget_pool_entries FOR ALL
TO service_role
USING (true) WITH CHECK (true);

CREATE INDEX budget_pool_entries_day_idx ON public.budget_pool_entries (pool_day, status);
CREATE INDEX budget_pool_entries_decision_idx ON public.budget_pool_entries (decision_id);

CREATE TRIGGER budget_pool_entries_updated_at
BEFORE UPDATE ON public.budget_pool_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();