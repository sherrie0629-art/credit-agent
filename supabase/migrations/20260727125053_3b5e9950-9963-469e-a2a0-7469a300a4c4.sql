CREATE TABLE public.creative_placements (
  creative_id text NOT NULL,
  campaign_id text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  share numeric NOT NULL DEFAULT 1,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (creative_id, campaign_id)
);

GRANT ALL ON public.creative_placements TO service_role;

ALTER TABLE public.creative_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creative_placements service only"
  ON public.creative_placements FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_creative_placements_updated_at
  BEFORE UPDATE ON public.creative_placements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.creative_placements (creative_id, campaign_id, status, share, started_at) VALUES
  ('crv_g_01', 'cmp_g_search_01', 'ACTIVE', 0.62, now() - interval '21 days'),
  ('crv_g_01', 'cmp_g_pmax_02', 'ACTIVE', 0.38, now() - interval '14 days'),
  ('crv_m_02', 'cmp_m_feed_03', 'ACTIVE', 1.00, now() - interval '18 days'),
  ('crv_reels_88', 'cmp_m_reels_04', 'ACTIVE', 0.74, now() - interval '30 days'),
  ('crv_reels_88', 'cmp_m_feed_03', 'PAUSED', 0.00, now() - interval '40 days');

ALTER TABLE public.agent_decisions
  ADD COLUMN creative_id text,
  ADD COLUMN creative_name text;

UPDATE public.agent_decisions d
SET creative_id = d.campaign_id,
    creative_name = c.headline,
    campaign_id = p.campaign_id,
    campaign_name = cm.name
FROM public.creative_assets c
JOIN public.creative_placements p
  ON p.creative_id = c.id AND p.status = 'ACTIVE'
JOIN public.campaigns cm ON cm.id = p.campaign_id
WHERE d.campaign_id = c.id
  AND p.share = (
    SELECT max(p2.share) FROM public.creative_placements p2
    WHERE p2.creative_id = c.id AND p2.status = 'ACTIVE'
  );