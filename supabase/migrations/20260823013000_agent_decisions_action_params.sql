ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS action_params jsonb;
