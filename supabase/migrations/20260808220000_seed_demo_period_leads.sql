-- Demo leads + events for period analytics (true-window path).
-- Safe to re-run: deletes previous demo_* ids first.
-- Upstream→downstream: LEAD → CREDIT_APPROVED → LOAN_DISBURSED (subset).

DELETE FROM public.lead_events WHERE id LIKE 'demo_ev_%';
DELETE FROM public.leads WHERE id LIKE 'demo_lead_%';

WITH groups AS (
  SELECT id, campaign_id, channel,
         row_number() OVER (PARTITION BY channel ORDER BY sort_order, id) AS rn
  FROM public.ad_groups
  WHERE status = 'ACTIVE'
),
picked AS (
  SELECT * FROM groups WHERE rn = 1
),
seed AS (
  SELECT * FROM (VALUES
    -- Google: 8 leads, 3 approved, 2 disbursed
    ('demo_lead_g01', 'Google', 0, true,  true,  4200),
    ('demo_lead_g02', 'Google', 1, true,  true,  3800),
    ('demo_lead_g03', 'Google', 2, true,  false, 0),
    ('demo_lead_g04', 'Google', 3, false, false, 0),
    ('demo_lead_g05', 'Google', 4, false, false, 0),
    ('demo_lead_g06', 'Google', 5, false, false, 0),
    ('demo_lead_g07', 'Google', 1, false, false, 0),
    ('demo_lead_g08', 'Google', 2, false, false, 0),
    -- Meta: 6 leads, 2 approved, 1 disbursed
    ('demo_lead_m01', 'Meta', 0, true,  true,  5100),
    ('demo_lead_m02', 'Meta', 1, true,  false, 0),
    ('demo_lead_m03', 'Meta', 2, false, false, 0),
    ('demo_lead_m04', 'Meta', 3, false, false, 0),
    ('demo_lead_m05', 'Meta', 4, false, false, 0),
    ('demo_lead_m06', 'Meta', 1, false, false, 0)
  ) AS t(id, channel, day_offset, approved, disbursed, amount)
)
INSERT INTO public.leads (
  id, channel, campaign_id, ad_group_id, landing_url, click_at, created_at, gclid, fbclid
)
SELECT
  s.id,
  s.channel,
  coalesce(p.campaign_id, 'cmp_demo'),
  p.id,
  'https://example.com/apply?demo=' || s.id,
  (date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')
    - (s.day_offset || ' days')::interval + interval '14 hours',
  (date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')
    - (s.day_offset || ' days')::interval + interval '14 hours',
  CASE WHEN s.channel = 'Google' THEN 'gclid_' || s.id ELSE NULL END,
  CASE WHEN s.channel = 'Meta' THEN 'fbclid_' || s.id ELSE NULL END
FROM seed s
LEFT JOIN picked p ON p.channel = s.channel;

INSERT INTO public.lead_events (id, lead_id, event_type, value, currency, occurred_at)
SELECT
  'demo_ev_appr_' || s.id,
  s.id,
  'CREDIT_APPROVED',
  0,
  'USD',
  (date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')
    - (s.day_offset || ' days')::interval + interval '16 hours'
FROM (
  SELECT * FROM (VALUES
    ('demo_lead_g01', 0), ('demo_lead_g02', 1), ('demo_lead_g03', 2),
    ('demo_lead_m01', 0), ('demo_lead_m02', 1)
  ) AS t(id, day_offset)
) s
WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.id = s.id);

INSERT INTO public.lead_events (id, lead_id, event_type, value, currency, occurred_at)
SELECT
  'demo_ev_loan_' || s.id,
  s.id,
  'LOAN_DISBURSED',
  s.amount,
  'USD',
  (date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')
    - (s.day_offset || ' days')::interval + interval '20 hours'
FROM (
  SELECT * FROM (VALUES
    ('demo_lead_g01', 0, 4200::numeric),
    ('demo_lead_g02', 1, 3800::numeric),
    ('demo_lead_m01', 0, 5100::numeric)
  ) AS t(id, day_offset, amount)
) s
WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.id = s.id);
