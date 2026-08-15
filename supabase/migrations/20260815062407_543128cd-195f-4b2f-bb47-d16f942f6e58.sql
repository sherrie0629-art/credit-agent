ALTER TABLE public.creative_videos
  ADD COLUMN IF NOT EXISTS segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS captions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'SCRIPTING';

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.creative_videos'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.creative_videos DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.creative_videos
  ADD CONSTRAINT creative_videos_status_check
  CHECK (status IN ('QUEUED','RUNNING','COMPOSING','COMPLETED','FAILED'));