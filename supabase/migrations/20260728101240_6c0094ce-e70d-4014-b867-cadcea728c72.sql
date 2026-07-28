-- 1. ad_groups table
CREATE TABLE public.ad_groups (
  id text PRIMARY KEY,
  campaign_id text NOT NULL,
  name text NOT NULL,
  channel text NOT NULL,
  placement text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT '',
  bid_strategy text NOT NULL DEFAULT 'tCPA',
  status text NOT NULL DEFAULT 'ACTIVE',
  daily_budget numeric NOT NULL DEFAULT 0,
  spent_today numeric NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  compliance_pass_rate numeric NOT NULL DEFAULT 0,
  ai_suggestion text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ad_groups TO service_role;
ALTER TABLE public.ad_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ad_groups service only" ON public.ad_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_ad_groups_updated_at
  BEFORE UPDATE ON public.ad_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. sink existing campaigns into ad groups (ids preserved)
INSERT INTO public.ad_groups (
  id, campaign_id, name, channel, placement, audience, bid_strategy, status,
  daily_budget, spent_today, impressions, clicks, compliance_pass_rate,
  ai_suggestion, sort_order
)
SELECT
  c.id,
  CASE WHEN c.channel = 'Google' THEN 'cmp_google_acq' ELSE 'cmp_meta_acq' END,
  CASE c.id
    WHEN 'cmp_g_search_01' THEN 'Search — 品牌 + 精确匹配词'
    WHEN 'cmp_g_pmax_02'   THEN 'PMax — 债务整合泛人群'
    WHEN 'cmp_m_feed_03'   THEN 'Feed — Lookalike 3%'
    WHEN 'cmp_m_reels_04'  THEN 'Reels — 创作者 UGC'
    ELSE c.name
  END,
  c.channel,
  c.placement,
  CASE c.id
    WHEN 'cmp_g_search_01' THEN '高意向搜索词 · 美国'
    WHEN 'cmp_g_pmax_02'   THEN '信号建模泛人群'
    WHEN 'cmp_m_feed_03'   THEN '放款客户 Lookalike 3%'
    WHEN 'cmp_m_reels_04'  THEN '25-44 岁短视频人群'
    ELSE ''
  END,
  CASE WHEN c.channel = 'Google' THEN 'tCPA' ELSE 'Lowest Cost' END,
  c.status, c.daily_budget, c.spent_today, c.impressions, c.clicks,
  c.compliance_pass_rate, c.ai_suggestion, c.sort_order
FROM public.campaigns c;

-- 3. parent campaigns
INSERT INTO public.campaigns (
  id, name, channel, placement, status, daily_budget, spent_today,
  impressions, clicks, leads, approved_loans, disbursed_amount,
  cpl, cps, compliance_pass_rate, last20_approval_rate, ai_suggestion, sort_order
)
SELECT
  CASE WHEN g.channel = 'Google' THEN 'cmp_google_acq' ELSE 'cmp_meta_acq' END,
  CASE WHEN g.channel = 'Google' THEN 'Google — 美国消费信贷获客' ELSE 'Meta — 美国消费信贷获客' END,
  g.channel, '', 'ACTIVE',
  sum(g.daily_budget), sum(g.spent_today), sum(g.impressions), sum(g.clicks),
  0, 0, 0, 0, 0, avg(g.compliance_pass_rate), 0,
  '按广告组后端放款表现动态分配预算', CASE WHEN g.channel = 'Google' THEN 1 ELSE 2 END
FROM public.ad_groups g
GROUP BY g.channel;

-- 4. repoint child tables to ad_group + parent campaign
ALTER TABLE public.leads ADD COLUMN ad_group_id text;
UPDATE public.leads SET ad_group_id = campaign_id;
UPDATE public.leads l SET campaign_id = g.campaign_id
  FROM public.ad_groups g WHERE g.id = l.ad_group_id;

ALTER TABLE public.creative_placements ADD COLUMN ad_group_id text;
UPDATE public.creative_placements SET ad_group_id = campaign_id;
ALTER TABLE public.creative_placements DROP CONSTRAINT IF EXISTS creative_placements_pkey;
UPDATE public.creative_placements p SET campaign_id = g.campaign_id
  FROM public.ad_groups g WHERE g.id = p.ad_group_id;
ALTER TABLE public.creative_placements ALTER COLUMN ad_group_id SET NOT NULL;
ALTER TABLE public.creative_placements ADD PRIMARY KEY (creative_id, ad_group_id);

ALTER TABLE public.creative_metrics ADD COLUMN ad_group_id text;
UPDATE public.creative_metrics SET ad_group_id = campaign_id;
UPDATE public.creative_metrics m SET campaign_id = g.campaign_id
  FROM public.ad_groups g WHERE g.id = m.ad_group_id;

ALTER TABLE public.channel_breakdown ADD COLUMN ad_group_id text;
UPDATE public.channel_breakdown SET ad_group_id = campaign_id;
UPDATE public.channel_breakdown b SET campaign_id = g.campaign_id
  FROM public.ad_groups g WHERE g.id = b.ad_group_id;

ALTER TABLE public.agent_decisions ADD COLUMN ad_group_id text;
ALTER TABLE public.agent_decisions ADD COLUMN ad_group_name text;
UPDATE public.agent_decisions d SET ad_group_id = d.campaign_id, ad_group_name = g.name
  FROM public.ad_groups g WHERE g.id = d.campaign_id;
UPDATE public.agent_decisions d SET campaign_id = g.campaign_id,
       campaign_name = c.name
  FROM public.ad_groups g JOIN public.campaigns c ON c.id = g.campaign_id
  WHERE g.id = d.ad_group_id;

-- 5. drop the old campaign rows that are now ad groups
DELETE FROM public.campaigns WHERE id IN (SELECT id FROM public.ad_groups);

ALTER TABLE public.ad_groups
  ADD CONSTRAINT ad_groups_campaign_fk FOREIGN KEY (campaign_id)
  REFERENCES public.campaigns(id) ON DELETE CASCADE;

CREATE INDEX idx_leads_ad_group ON public.leads(ad_group_id);
CREATE INDEX idx_ad_groups_campaign ON public.ad_groups(campaign_id);

-- 6. views
DROP VIEW IF EXISTS public.v_placement_facts;
DROP VIEW IF EXISTS public.v_campaign_facts;
DROP VIEW IF EXISTS public.v_adgroup_facts;

CREATE VIEW public.v_adgroup_facts AS
SELECT
  g.id AS ad_group_id,
  g.campaign_id,
  COALESCE(f.leads, 0) AS leads,
  COALESCE(f.approved, 0) AS approved_loans,
  COALESCE(f.disbursed_count, 0) AS disbursed_count,
  COALESCE(f.disbursed_amount, 0) AS disbursed_amount,
  CASE WHEN COALESCE(f.leads,0) > 0 THEN round(g.spent_today / f.leads, 2) ELSE 0 END AS cpl,
  CASE WHEN COALESCE(f.disbursed_count,0) > 0 THEN round(g.spent_today / f.disbursed_count, 2) ELSE 0 END AS cps,
  COALESCE(r.last20_approval_rate, 0) AS last20_approval_rate
FROM public.ad_groups g
LEFT JOIN LATERAL (
  SELECT count(*) AS leads,
         count(*) FILTER (WHERE ev.approved) AS approved,
         count(*) FILTER (WHERE ev.disbursed_amt IS NOT NULL) AS disbursed_count,
         COALESCE(sum(ev.disbursed_amt), 0) AS disbursed_amount
  FROM public.leads l
  LEFT JOIN LATERAL (
    SELECT bool_or(le.event_type = 'CREDIT_APPROVED') AS approved,
           sum(le.value) FILTER (WHERE le.event_type = 'LOAN_DISBURSED') AS disbursed_amt
    FROM public.lead_events le WHERE le.lead_id = l.id
  ) ev ON true
  WHERE l.ad_group_id = g.id
) f ON true
LEFT JOIN LATERAL (
  SELECT round(avg(CASE WHEN x.approved THEN 1 ELSE 0 END), 4) AS last20_approval_rate
  FROM (
    SELECT bool_or(le.event_type = 'CREDIT_APPROVED') AS approved
    FROM public.leads l2
    LEFT JOIN public.lead_events le ON le.lead_id = l2.id
    WHERE l2.ad_group_id = g.id
    GROUP BY l2.id, l2.click_at
    ORDER BY l2.click_at DESC
    LIMIT 20
  ) x
) r ON true;

CREATE VIEW public.v_campaign_facts AS
SELECT
  c.id AS campaign_id,
  COALESCE(f.leads, 0) AS leads,
  COALESCE(f.approved, 0) AS approved_loans,
  COALESCE(f.disbursed_count, 0) AS disbursed_count,
  COALESCE(f.disbursed_amount, 0) AS disbursed_amount,
  CASE WHEN COALESCE(f.leads,0) > 0 THEN round(COALESCE(sp.spend,0) / f.leads, 2) ELSE 0 END AS cpl,
  CASE WHEN COALESCE(f.disbursed_count,0) > 0 THEN round(COALESCE(sp.spend,0) / f.disbursed_count, 2) ELSE 0 END AS cps,
  COALESCE(r.last20_approval_rate, 0) AS last20_approval_rate
FROM public.campaigns c
LEFT JOIN LATERAL (
  SELECT sum(g.spent_today) AS spend FROM public.ad_groups g WHERE g.campaign_id = c.id
) sp ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS leads,
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
  SELECT round(avg(CASE WHEN x.approved THEN 1 ELSE 0 END), 4) AS last20_approval_rate
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

CREATE VIEW public.v_placement_facts AS
SELECT
  l.creative_id,
  l.ad_group_id,
  l.campaign_id,
  count(DISTINCT l.id) AS leads,
  count(DISTINCT CASE WHEN e.event_type = 'CREDIT_APPROVED' THEN l.id END) AS approved,
  count(DISTINCT CASE WHEN e.event_type = 'LOAN_DISBURSED' THEN l.id END) AS disbursed_count,
  COALESCE(sum(CASE WHEN e.event_type = 'LOAN_DISBURSED' THEN e.value ELSE 0 END), 0) AS disbursed_amount
FROM public.leads l
LEFT JOIN public.lead_events e ON e.lead_id = l.id
WHERE l.creative_id IS NOT NULL
GROUP BY l.creative_id, l.ad_group_id, l.campaign_id;