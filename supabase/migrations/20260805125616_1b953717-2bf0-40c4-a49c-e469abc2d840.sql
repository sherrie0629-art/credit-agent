CREATE OR REPLACE FUNCTION public.get_budget_pool_today()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(json_agg(t ORDER BY t.created_at DESC), '[]'::json)
  FROM public.budget_pool_entries t
  WHERE t.pool_day = ((now() AT TIME ZONE 'utc')::date)
    AND t.status <> 'REVERTED';
$$;

GRANT EXECUTE ON FUNCTION public.get_agent_snapshot() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_budget_pool_today() TO anon, authenticated, service_role;