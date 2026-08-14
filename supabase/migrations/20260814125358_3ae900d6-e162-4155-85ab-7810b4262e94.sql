DROP POLICY IF EXISTS "creative_videos_no_public_select" ON storage.objects;
DROP POLICY IF EXISTS "creative_videos_no_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "creative_videos_no_public_update" ON storage.objects;
DROP POLICY IF EXISTS "creative_videos_no_public_delete" ON storage.objects;

CREATE POLICY "creative_videos_no_public_select"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id <> 'creative-videos' AND false);

CREATE POLICY "creative_videos_no_public_insert"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id <> 'creative-videos' AND false);

CREATE POLICY "creative_videos_no_public_update"
ON storage.objects FOR UPDATE TO anon, authenticated
USING (bucket_id <> 'creative-videos' AND false)
WITH CHECK (bucket_id <> 'creative-videos' AND false);

CREATE POLICY "creative_videos_no_public_delete"
ON storage.objects FOR DELETE TO anon, authenticated
USING (bucket_id <> 'creative-videos' AND false);