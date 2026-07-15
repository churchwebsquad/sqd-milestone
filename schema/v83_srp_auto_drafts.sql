-- v83: add auto_drafts JSONB to srp_pipeline.sessions
-- Stores all AI-generated options for each deliverable step so they are
-- pre-populated when the coach arrives, without requiring them to click Generate.
-- Shape: { overview, carousel, facebook, photoRecap, sundayInvite }

ALTER TABLE srp_pipeline.sessions
  ADD COLUMN IF NOT EXISTS auto_drafts JSONB DEFAULT NULL;
