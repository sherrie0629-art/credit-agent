ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS ontology_before jsonb,
  ADD COLUMN IF NOT EXISTS ontology_diff jsonb;