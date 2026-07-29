CREATE OR REPLACE FUNCTION public.get_agent_snapshot()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'decisions', (SELECT coalesce(json_agg(t ORDER BY t.timestamp DESC), '[]'::json) FROM public.agent_decisions t),
    'campaigns', (SELECT coalesce(json_agg(t ORDER BY t.sort_order), '[]'::json) FROM public.campaigns t),
    'ad_groups', (SELECT coalesce(json_agg(t ORDER BY t.sort_order), '[]'::json) FROM public.ad_groups t),
    'creative_assets', (SELECT coalesce(json_agg(t ORDER BY t.sort_order), '[]'::json) FROM public.creative_assets t),
    'settings', (SELECT to_json(t) FROM public.agent_settings t WHERE t.id = 'default'),
    'funnel_stages', (SELECT coalesce(json_agg(t ORDER BY t.sort_order), '[]'::json) FROM public.funnel_stages t),
    'channel_trend', (SELECT coalesce(json_agg(t ORDER BY t.sort_order), '[]'::json) FROM public.channel_trend t),
    'channel_breakdown', (SELECT coalesce(json_agg(t ORDER BY t.sort_order), '[]'::json) FROM public.channel_breakdown t),
    'creative_metrics', (SELECT coalesce(json_agg(t ORDER BY t.day), '[]'::json) FROM public.creative_metrics t),
    'creative_variants', (SELECT coalesce(json_agg(t ORDER BY t.created_at DESC), '[]'::json) FROM public.creative_variants t),
    'creative_experiments', (SELECT coalesce(json_agg(t ORDER BY t.started_at DESC), '[]'::json) FROM public.creative_experiments t),
    'creative_placements', (SELECT coalesce(json_agg(t ORDER BY t.share DESC), '[]'::json) FROM public.creative_placements t),
    'v_placement_facts', (SELECT coalesce(json_agg(t), '[]'::json) FROM public.v_placement_facts t),
    'v_campaign_facts', (SELECT coalesce(json_agg(t), '[]'::json) FROM public.v_campaign_facts t),
    'v_adgroup_facts', (SELECT coalesce(json_agg(t), '[]'::json) FROM public.v_adgroup_facts t),
    'v_creative_facts', (SELECT coalesce(json_agg(t), '[]'::json) FROM public.v_creative_facts t),
    'v_funnel', (SELECT coalesce(json_agg(t ORDER BY t.sort_order), '[]'::json) FROM public.v_funnel t),
    'conversion_uploads', (SELECT coalesce(json_agg(json_build_object('event_id', u.event_id, 'platform', u.platform, 'status', u.status)), '[]'::json) FROM public.conversion_uploads u),
    'disbursed_events', (SELECT coalesce(json_agg(json_build_object('id', e.id, 'channel', coalesce(l.channel, 'Google'))), '[]'::json)
                          FROM public.lead_events e LEFT JOIN public.leads l ON l.id = e.lead_id
                          WHERE e.event_type = 'LOAN_DISBURSED')
  );
$$;

REVOKE ALL ON FUNCTION public.get_agent_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_snapshot() TO service_role;