-- 1) leads → creative
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS creative_id text;
CREATE INDEX IF NOT EXISTS leads_creative_idx ON public.leads (creative_id);

UPDATE public.leads l
SET creative_id = (
  SELECT p.creative_id
  FROM public.creative_placements p
  WHERE p.campaign_id = l.campaign_id AND p.status = 'ACTIVE'
  ORDER BY -ln(random() + 1e-9) / GREATEST(p.share, 0.01)
  LIMIT 1
)
WHERE l.creative_id IS NULL;

-- 2) channel_breakdown → campaign
ALTER TABLE public.channel_breakdown ADD COLUMN IF NOT EXISTS campaign_id text;
UPDATE public.channel_breakdown SET campaign_id = 'cmp_g_search_01' WHERE channel = 'Google Search';
UPDATE public.channel_breakdown SET campaign_id = 'cmp_g_pmax_02'   WHERE channel = 'Google PMax';
UPDATE public.channel_breakdown SET campaign_id = 'cmp_m_feed_03'   WHERE channel = 'Meta Feed';
UPDATE public.channel_breakdown SET campaign_id = 'cmp_m_reels_04'  WHERE channel = 'Meta Reels';

-- 3) creative_metrics → campaign
ALTER TABLE public.creative_metrics ADD COLUMN IF NOT EXISTS campaign_id text;
UPDATE public.creative_metrics m
SET campaign_id = p.campaign_id
FROM (
  SELECT DISTINCT ON (creative_id) creative_id, campaign_id
  FROM public.creative_placements
  WHERE status = 'ACTIVE'
  ORDER BY creative_id, share DESC
) p
WHERE p.creative_id = m.creative_id AND m.campaign_id IS NULL;

-- 4) 派生视图：广告系列真实绩效
CREATE OR REPLACE VIEW public.v_campaign_facts
WITH (security_invoker = true) AS
SELECT
  c.id AS campaign_id,
  COALESCE(f.leads, 0) AS leads,
  COALESCE(f.approved, 0) AS approved_loans,
  COALESCE(f.disbursed_count, 0) AS disbursed_count,
  COALESCE(f.disbursed_amount, 0) AS disbursed_amount,
  CASE WHEN COALESCE(f.leads,0) > 0
       THEN round(c.spent_today / f.leads, 2) ELSE 0 END AS cpl,
  CASE WHEN COALESCE(f.disbursed_count,0) > 0
       THEN round(c.spent_today / f.disbursed_count, 2) ELSE 0 END AS cps,
  COALESCE(r.last20_approval_rate, 0) AS last20_approval_rate
FROM public.campaigns c
LEFT JOIN LATERAL (
  SELECT
    count(*) AS leads,
    count(*) FILTER (WHERE ev.approved) AS approved,
    count(*) FILTER (WHERE ev.disbursed_amt IS NOT NULL) AS disbursed_count,
    COALESCE(sum(ev.disbursed_amt), 0) AS disbursed_amount
  FROM public.leads l
  LEFT JOIN LATERAL (
    SELECT bool_or(le.event_type = 'CREDIT_APPROVED') AS approved,
           sum(le.value) FILTER (WHERE le.event_type = 'LOAN_DISBURSED') AS disbursed_amt
    FROM public.lead_events le WHERE le.lead_id = l.id
  ) ev ON true
  WHERE l.campaign_id = c.id
) f ON true
LEFT JOIN LATERAL (
  SELECT round(avg(CASE WHEN x.approved THEN 1 ELSE 0 END)::numeric, 4) AS last20_approval_rate
  FROM (
    SELECT bool_or(le.event_type = 'CREDIT_APPROVED') AS approved
    FROM public.leads l2
    LEFT JOIN public.lead_events le ON le.lead_id = l2.id
    WHERE l2.campaign_id = c.id
    GROUP BY l2.id, l2.click_at
    ORDER BY l2.click_at DESC
    LIMIT 20
  ) x
) r ON true;

-- 5) 派生视图：素材真实绩效
CREATE OR REPLACE VIEW public.v_creative_facts
WITH (security_invoker = true) AS
SELECT
  a.id AS creative_id,
  COALESCE(s.spend, 0) AS spend,
  COALESCE(f.leads, 0) AS leads,
  COALESCE(f.approved, 0) AS approved_loans,
  COALESCE(f.disbursed_count, 0) AS disbursed_count,
  COALESCE(f.disbursed_amount, 0) AS disbursed_amount,
  CASE WHEN COALESCE(f.leads,0) > 0
       THEN round(COALESCE(s.spend,0) / f.leads, 2) ELSE 0 END AS cpl,
  CASE WHEN COALESCE(f.disbursed_count,0) > 0
       THEN round(COALESCE(s.spend,0) / f.disbursed_count, 2) ELSE 0 END AS cps,
  CASE WHEN COALESCE(f.leads,0) > 0
       THEN round(f.approved::numeric / f.leads, 4) ELSE 0 END AS approval_rate
FROM public.creative_assets a
LEFT JOIN LATERAL (
  SELECT sum(m.spend) AS spend FROM public.creative_metrics m WHERE m.creative_id = a.id
) s ON true
LEFT JOIN LATERAL (
  SELECT
    count(*) AS leads,
    count(*) FILTER (WHERE ev.approved) AS approved,
    count(*) FILTER (WHERE ev.disbursed_amt IS NOT NULL) AS disbursed_count,
    COALESCE(sum(ev.disbursed_amt), 0) AS disbursed_amount
  FROM public.leads l
  LEFT JOIN LATERAL (
    SELECT bool_or(le.event_type = 'CREDIT_APPROVED') AS approved,
           sum(le.value) FILTER (WHERE le.event_type = 'LOAN_DISBURSED') AS disbursed_amt
    FROM public.lead_events le WHERE le.lead_id = l.id
  ) ev ON true
  WHERE l.creative_id = a.id
) f ON true;

-- 6) 派生视图：全链路漏斗
CREATE OR REPLACE VIEW public.v_funnel
WITH (security_invoker = true) AS
SELECT 1 AS sort_order, 'Impressions' AS stage,
       (SELECT COALESCE(sum(impressions),0) FROM public.campaigns) AS value
UNION ALL
SELECT 2, 'Clicks', (SELECT COALESCE(sum(clicks),0) FROM public.campaigns)
UNION ALL
SELECT 3, 'Form Leads', (SELECT count(*) FROM public.leads)
UNION ALL
SELECT 4, 'Credit Approved',
       (SELECT count(DISTINCT lead_id) FROM public.lead_events WHERE event_type = 'CREDIT_APPROVED')
UNION ALL
SELECT 5, 'Loan Disbursed',
       (SELECT count(DISTINCT lead_id) FROM public.lead_events WHERE event_type = 'LOAN_DISBURSED');

GRANT SELECT ON public.v_campaign_facts TO service_role;
GRANT SELECT ON public.v_creative_facts TO service_role;
GRANT SELECT ON public.v_funnel TO service_role;
