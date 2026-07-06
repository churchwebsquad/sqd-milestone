-- v78: Add outro_logo_url to srp_pipeline.clip_templates
-- Stores the per-church animated logo file URL for reel outros.
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE srp_pipeline.clip_templates
  ADD COLUMN IF NOT EXISTS outro_logo_url TEXT;

COMMENT ON COLUMN srp_pipeline.clip_templates.outro_logo_url IS
  'Wasabi/Supabase Storage URL for the church animated logo used as a reel outro. Reused across sessions once set.';
