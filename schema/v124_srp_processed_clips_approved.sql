-- Add transcript_approved flag to srp_pipeline.processed_clips.
-- When true, the transcript is locked as the source of truth for all
-- downstream steps (caption preview, caption bake, Creative Direction).

ALTER TABLE srp_pipeline.processed_clips
  ADD COLUMN IF NOT EXISTS transcript_approved boolean NOT NULL DEFAULT false;
