-- Bid target amount for strategies that require it (Google tCPA / Meta Cost Cap).
-- NULL when strategy is Maximize Conversions / Lowest Cost.
ALTER TABLE public.ad_groups
  ADD COLUMN IF NOT EXISTS bid_target numeric;

COMMENT ON COLUMN public.ad_groups.bid_target IS
  'Target CPA ($) for tCPA, or Cost Cap ($) for Meta Cost Cap. NULL when strategy needs no target.';
