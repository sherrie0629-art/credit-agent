-- Optional RPC: period conversion facts by channel (leads / approve / disburse).
-- App server also aggregates via Data API if this RPC is unavailable.
CREATE OR REPLACE FUNCTION public.get_period_conversion_facts(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lead_win AS (
    SELECT id, channel
    FROM public.leads
    WHERE created_at >= p_from AND created_at < p_to
  ),
  ev AS (
    SELECT le.lead_id, le.event_type, le.value, COALESCE(l.channel, l2.channel) AS channel
    FROM public.lead_events le
    LEFT JOIN lead_win l ON l.id = le.lead_id
    LEFT JOIN public.leads l2 ON l2.id = le.lead_id
    WHERE le.occurred_at >= p_from AND le.occurred_at < p_to
  ),
  by_ch AS (
    SELECT
      ch.channel,
      (SELECT count(*) FROM lead_win lw WHERE lw.channel = ch.channel) AS leads,
      (SELECT count(DISTINCT lead_id) FROM ev WHERE channel = ch.channel AND event_type = 'CREDIT_APPROVED') AS approved,
      (SELECT count(DISTINCT lead_id) FROM ev WHERE channel = ch.channel AND event_type = 'LOAN_DISBURSED') AS disbursed_count,
      (SELECT COALESCE(sum(value), 0) FROM ev WHERE channel = ch.channel AND event_type = 'LOAN_DISBURSED') AS disbursed_amount
    FROM (SELECT DISTINCT channel FROM public.leads) ch
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(by_ch)), '[]'::jsonb) FROM by_ch;
$$;

GRANT EXECUTE ON FUNCTION public.get_period_conversion_facts(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_period_conversion_facts(timestamptz, timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION public.get_period_conversion_facts(timestamptz, timestamptz) TO authenticated;
