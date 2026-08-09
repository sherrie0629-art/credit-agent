-- Google Ads test API: local ↔ Google resource name bindings + mutate audit fields.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS google_resource_name text,
  ADD COLUMN IF NOT EXISTS google_budget_resource_name text;

ALTER TABLE public.ad_groups
  ADD COLUMN IF NOT EXISTS google_resource_name text;

ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS external_mutate_status text,
  ADD COLUMN IF NOT EXISTS external_mutate_detail text;

COMMENT ON COLUMN public.campaigns.google_resource_name IS
  'Google Ads campaign resource name, e.g. customers/123/campaigns/456';
COMMENT ON COLUMN public.campaigns.google_budget_resource_name IS
  'Google Ads campaign_budget resource name used for daily budget mutates';
COMMENT ON COLUMN public.ad_groups.google_resource_name IS
  'Google Ads ad_group resource name, e.g. customers/123/adGroups/789';
COMMENT ON COLUMN public.agent_decisions.external_mutate_status IS
  'Google Ads mutate outcome: PUSHED / SKIPPED_* / FAILED';
COMMENT ON COLUMN public.agent_decisions.external_mutate_detail IS
  'Human-readable Google Ads mutate summary for on-call triage';