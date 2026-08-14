CREATE TABLE IF NOT EXISTS public.creative_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_id TEXT NOT NULL,
  target_kind TEXT NOT NULL DEFAULT 'variant',
  job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  video_url TEXT,
  error_message TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  seconds TEXT NOT NULL DEFAULT '8',
  size TEXT NOT NULL DEFAULT '720x1280',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS creative_videos_job_id_key ON public.creative_videos (job_id);
CREATE INDEX IF NOT EXISTS creative_videos_target_idx ON public.creative_videos (target_id, created_at DESC);

GRANT ALL ON public.creative_videos TO service_role;

ALTER TABLE public.creative_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "creative_videos service only" ON public.creative_videos;
CREATE POLICY "creative_videos service only"
  ON public.creative_videos
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);