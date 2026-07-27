-- ============ leads ============
CREATE TABLE public.leads (
  id text PRIMARY KEY,
  channel text NOT NULL,
  campaign_id text NOT NULL,
  gclid text,
  gbraid text,
  wbraid text,
  fbclid text,
  fbp text,
  fbc text,
  hashed_email text,
  hashed_phone text,
  landing_url text NOT NULL DEFAULT '',
  click_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads service only" ON public.leads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX leads_campaign_idx ON public.leads (campaign_id);
CREATE INDEX leads_click_at_idx ON public.leads (click_at DESC);
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ lead_events ============
CREATE TABLE public.lead_events (
  id text PRIMARY KEY,
  lead_id text NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.lead_events TO service_role;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_events service only" ON public.lead_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX lead_events_lead_idx ON public.lead_events (lead_id);
CREATE INDEX lead_events_occurred_idx ON public.lead_events (occurred_at DESC);

-- ============ conversion_uploads ============
CREATE TABLE public.conversion_uploads (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES public.lead_events(id) ON DELETE CASCADE,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  match_quality numeric NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, platform)
);
GRANT ALL ON public.conversion_uploads TO service_role;
ALTER TABLE public.conversion_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversion_uploads service only" ON public.conversion_uploads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX conversion_uploads_status_idx ON public.conversion_uploads (status);
CREATE INDEX conversion_uploads_created_idx ON public.conversion_uploads (created_at DESC);
CREATE TRIGGER conversion_uploads_updated_at BEFORE UPDATE ON public.conversion_uploads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ conversion_settings ============
CREATE TABLE public.conversion_settings (
  platform text PRIMARY KEY,
  mode text NOT NULL DEFAULT 'MOCK',
  enabled boolean NOT NULL DEFAULT true,
  destination_id text NOT NULL DEFAULT '',
  conversion_action text NOT NULL DEFAULT '',
  lookback_days integer NOT NULL DEFAULT 90,
  value_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.conversion_settings TO service_role;
ALTER TABLE public.conversion_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversion_settings service only" ON public.conversion_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER conversion_settings_updated_at BEFORE UPDATE ON public.conversion_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.conversion_settings (platform, mode, enabled, destination_id, conversion_action, lookback_days, value_rules) VALUES
  ('google', 'MOCK', true, '123-456-7890', 'customers/1234567890/conversionActions/987654321', 90,
    '{"LEAD": 0, "CREDIT_APPROVED": 30, "LOAN_DISBURSED": "0.06*amount", "FIRST_PAYMENT_DEFAULT": "-0.5*amount"}'::jsonb),
  ('meta', 'MOCK', true, '拟接入 Dataset ID', 'Purchase', 7,
    '{"LEAD": 0, "CREDIT_APPROVED": 30, "LOAN_DISBURSED": "0.06*amount", "FIRST_PAYMENT_DEFAULT": "-0.5*amount"}'::jsonb);

-- ============ seed simulated leads / events / uploads ============
DO $$
DECLARE
  i integer;
  lid text;
  ch text;
  camp text;
  clicked timestamptz;
  approved boolean;
  disbursed boolean;
  amt numeric;
  eid text;
  plat text;
  st text;
  err text;
  age_days integer;
BEGIN
  FOR i IN 1..260 LOOP
    lid := 'lead_' || lpad(i::text, 5, '0');
    IF i % 2 = 0 THEN ch := 'Google'; ELSE ch := 'Meta'; END IF;
    camp := CASE
      WHEN ch = 'Google' AND i % 4 = 0 THEN 'cmp_g_search_01'
      WHEN ch = 'Google' THEN 'cmp_g_pmax_02'
      WHEN i % 3 = 0 THEN 'cmp_m_reels_04'
      ELSE 'cmp_m_feed_03' END;
    age_days := (i % 30);
    clicked := now() - (age_days || ' days')::interval - ((i % 17) || ' hours')::interval;

    INSERT INTO public.leads (id, channel, campaign_id, gclid, gbraid, fbclid, fbp, fbc, hashed_email, hashed_phone, landing_url, click_at)
    VALUES (
      lid, ch, camp,
      CASE WHEN ch = 'Google' AND i % 11 <> 0 THEN 'Cj0KCQ' || md5(lid) END,
      CASE WHEN ch = 'Google' AND i % 11 = 0 THEN 'GB' || substr(md5(lid), 1, 16) END,
      CASE WHEN ch = 'Meta' THEN 'IwAR' || substr(md5(lid), 1, 20) END,
      CASE WHEN ch = 'Meta' THEN 'fb.1.' || (extract(epoch from clicked)::bigint)::text || '.' || (1000000000 + i)::text END,
      CASE WHEN ch = 'Meta' AND i % 9 <> 0 THEN 'fb.1.' || (extract(epoch from clicked)::bigint)::text || '.IwAR' || substr(md5(lid), 1, 12) END,
      encode(digest('user' || i || '@example.com', 'sha256'), 'hex'),
      encode(digest('+1555' || lpad(i::text, 7, '0'), 'sha256'), 'hex'),
      'https://credit-agent.lovable.app/lp?utm_source=' || lower(ch),
      clicked
    );

    -- LEAD event
    eid := lid || '_lead';
    INSERT INTO public.lead_events (id, lead_id, event_type, value, occurred_at)
    VALUES (eid, lid, 'LEAD', 0, clicked + interval '4 minutes');

    approved := (i % 10) < 4;
    disbursed := approved AND (i % 10) < 3;
    amt := 800 + ((i * 137) % 4200);

    IF approved THEN
      eid := lid || '_appr';
      INSERT INTO public.lead_events (id, lead_id, event_type, value, occurred_at)
      VALUES (eid, lid, 'CREDIT_APPROVED', 30, clicked + interval '3 hours');
    END IF;

    IF disbursed THEN
      eid := lid || '_disb';
      INSERT INTO public.lead_events (id, lead_id, event_type, value, occurred_at)
      VALUES (eid, lid, 'LOAN_DISBURSED', round(amt * 0.06, 2), clicked + interval '2 days');

      plat := CASE WHEN ch = 'Google' THEN 'google' ELSE 'meta' END;
      IF ch = 'Meta' AND age_days > 7 THEN
        st := 'SKIPPED'; err := 'OUTSIDE_LOOKBACK_WINDOW';
      ELSIF i % 13 = 0 THEN
        st := 'FAILED'; err := CASE WHEN ch = 'Google' THEN 'UNPARSEABLE_GCLID' ELSE 'INVALID_MATCH_KEYS' END;
      ELSIF i % 23 = 0 THEN
        st := 'PENDING'; err := NULL;
      ELSE
        st := 'SENT'; err := NULL;
      END IF;

      INSERT INTO public.conversion_uploads (id, event_id, platform, status, attempts, request_payload, response_body, error_code, match_quality, sent_at)
      VALUES (
        eid || '_' || plat, eid, plat, st,
        CASE st WHEN 'SENT' THEN 1 WHEN 'FAILED' THEN 3 ELSE 0 END,
        jsonb_build_object('seeded', true, 'platform', plat, 'value', round(amt * 0.06, 2)),
        CASE st WHEN 'SENT' THEN jsonb_build_object('accepted', 1) ELSE '{}'::jsonb END,
        err,
        CASE st WHEN 'SENT' THEN 0.7 + ((i % 30)::numeric / 100) ELSE 0 END,
        CASE WHEN st = 'SENT' THEN clicked + interval '2 days 20 minutes' END
      );
    END IF;

    IF disbursed AND i % 17 = 0 THEN
      eid := lid || '_fpd';
      INSERT INTO public.lead_events (id, lead_id, event_type, value, occurred_at)
      VALUES (eid, lid, 'FIRST_PAYMENT_DEFAULT', round(amt * -0.5, 2), clicked + interval '32 days');
    END IF;
  END LOOP;
END $$;