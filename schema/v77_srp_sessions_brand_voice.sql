-- Add brand_voice_guidelines to srp_pipeline.sessions so that when a
-- session is created from the Social Hub (SocialChurchPage), the intel
-- profile's brand voice is stored on the session row and auto-loaded
-- into the SRP workflow on step 1.

ALTER TABLE srp_pipeline.sessions
  ADD COLUMN IF NOT EXISTS brand_voice_guidelines TEXT;

COMMENT ON COLUMN srp_pipeline.sessions.brand_voice_guidelines IS
  'Brand voice text pre-loaded from strategy_church_intel when the session is created via the Social Hub. Auto-seeds the AccountSelection step textarea.';
