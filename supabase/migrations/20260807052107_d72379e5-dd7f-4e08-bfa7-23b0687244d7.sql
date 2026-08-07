CREATE OR REPLACE FUNCTION public.get_conversion_snapshot()
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH u AS (
    SELECT * FROM public.conversion_uploads ORDER BY created_at DESC LIMIT 300
  ), e AS (
    SELECT * FROM public.lead_events WHERE id IN (SELECT event_id FROM u)
  ), l AS (
    SELECT * FROM public.leads WHERE id IN (SELECT lead_id FROM e)
  )
  SELECT json_build_object(
    'conversion_uploads', (SELECT coalesce(json_agg(t ORDER BY t.created_at DESC), '[]'::json) FROM u t),
    'lead_events', (SELECT coalesce(json_agg(json_build_object('id', t.id, 'lead_id', t.lead_id, 'event_type', t.event_type, 'value', t.value, 'occurred_at', t.occurred_at)), '[]'::json) FROM e t),
    'leads', (SELECT coalesce(json_agg(json_build_object('id', t.id, 'channel', t.channel, 'campaign_id', t.campaign_id)), '[]'::json) FROM l t),
    'conversion_settings', (SELECT coalesce(json_agg(t), '[]'::json) FROM public.conversion_settings t),
    'lead_count', (SELECT count(*) FROM public.leads),
    'disbursed_events', (SELECT coalesce(json_agg(json_build_object('id', t.id, 'occurred_at', t.occurred_at)), '[]'::json)
                          FROM public.lead_events t WHERE t.event_type = 'LOAN_DISBURSED')
  );
$function$;

REVOKE ALL ON FUNCTION public.get_conversion_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_conversion_snapshot() TO anon, authenticated, service_role;