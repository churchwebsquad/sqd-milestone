-- ============================================================================
-- v9_asset_attachment.sql
-- Adds 'attachment' as a valid asset_type and wires up a Supabase Storage
-- bucket for uploaded images. Also backfills 'vista_social' in the CHECK
-- constraint (the TS union had it but the DB didn't — would fail inserts).
-- ============================================================================

-- 1. Widen the asset_type CHECK constraint to include 'attachment' + 'vista_social'.
ALTER TABLE strategy_submission_assets
  DROP CONSTRAINT IF EXISTS strategy_submission_assets_asset_type_check;

ALTER TABLE strategy_submission_assets
  ADD CONSTRAINT strategy_submission_assets_asset_type_check
  CHECK (asset_type = ANY (ARRAY[
    'loom_video'::text,
    'brand_guide'::text,
    'markup_review'::text,
    'figma_file'::text,
    'dropbox_folder'::text,
    'style_guide'::text,
    'mood_board'::text,
    'contentsnare'::text,
    'website_link'::text,
    'document'::text,
    'vista_social'::text,
    'form'::text,
    'attachment'::text,
    'other'::text
  ]));

-- 2. Create the submission-attachments bucket (public-read, 10MB cap, images only).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'submission-attachments',
  'submission-attachments',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3. Storage RLS policies — authenticated staff upload, public read.
DROP POLICY IF EXISTS "Authenticated staff can upload attachments" ON storage.objects;
CREATE POLICY "Authenticated staff can upload attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'submission-attachments');

DROP POLICY IF EXISTS "Anyone can read attachments" ON storage.objects;
CREATE POLICY "Anyone can read attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'submission-attachments');

-- Staff can also replace their own uploads and clean up (for the "Replace"
-- flow in the UI). Restricted to files they uploaded (owner = auth.uid()).
DROP POLICY IF EXISTS "Staff can replace their attachments" ON storage.objects;
CREATE POLICY "Staff can replace their attachments"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'submission-attachments' AND owner = auth.uid());

DROP POLICY IF EXISTS "Staff can delete their attachments" ON storage.objects;
CREATE POLICY "Staff can delete their attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'submission-attachments' AND owner = auth.uid());
