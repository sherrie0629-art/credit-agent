-- Read-only conversion dashboard snapshot for local dev (publishable key + anon RPC).
-- Writes still require service_role on the server.

CREATE OR REPLACE FUNCTION public.get_conversion_snapshot()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH uploads AS (
    SELECT *
    FROM public.conversion_uploads
    ORDER BY created_at DESC
    LIMIT 200
  ),
  upload_events AS (
    SELECT e.*
    FROM public.lead_events e
    WHERE e.id IN (SELECT event_id FROM uploads)
  ),
  disbursed AS (
    SELECT id, occurred_at
    FROM public.lead_events
    WHERE event_type = 'LOAN_DISBURSED'
    ORDER BY occurred_at DESC
    LIMIT 400
  ),
  related_leads AS (
    SELECT l.id, l.channel, l.campaign_id
    FROM public.leads l
    WHERE l.id IN (SELECT lead_id FROM upload_events)
  )
  SELECT json_build_object(
    'conversion_uploads',
      (SELECT coalesce(json_agg(u ORDER BY u.created_at DESC), '[]'::json) FROM uploads u),
    'conversion_settings',
      (SELECT coalesce(json_agg(s ORDER BY s.platform), '[]'::json) FROM public.conversion_settings s),
    'lead_count',
      (SELECT count(*)::int FROM public.leads),
    'lead_events',
      (SELECT coalesce(json_agg(e), '[]'::json) FROM upload_events e),
    'disbursed_events',
      (SELECT coalesce(json_agg(d ORDER BY d.occurred_at DESC), '[]'::json) FROM disbursed d),
    'leads',
      (SELECT coalesce(json_agg(l), '[]'::json) FROM related_leads l)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_conversion_snapshot() TO anon, authenticated, service_role;
