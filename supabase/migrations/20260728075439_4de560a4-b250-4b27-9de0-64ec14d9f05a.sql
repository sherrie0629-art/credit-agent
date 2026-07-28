CREATE OR REPLACE VIEW public.v_placement_facts AS
SELECT
  l.creative_id,
  l.campaign_id,
  COUNT(DISTINCT l.id) AS leads,
  COUNT(DISTINCT CASE WHEN e.event_type = 'CREDIT_APPROVED' THEN l.id END) AS approved,
  COUNT(DISTINCT CASE WHEN e.event_type = 'LOAN_DISBURSED' THEN l.id END) AS disbursed_count,
  COALESCE(SUM(CASE WHEN e.event_type = 'LOAN_DISBURSED' THEN e.value ELSE 0 END), 0) AS disbursed_amount
FROM public.leads l
LEFT JOIN public.lead_events e ON e.lead_id = l.id
WHERE l.creative_id IS NOT NULL
GROUP BY l.creative_id, l.campaign_id;

REVOKE ALL ON public.v_placement_facts FROM anon, authenticated;
GRANT SELECT ON public.v_placement_facts TO service_role;