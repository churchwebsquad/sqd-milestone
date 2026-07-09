-- v81: Persist step inputs on srp_pipeline.sessions
-- Adds JSONB columns so per-step user config (guidance text, selected options,
-- citations, tags) survives navigation away and browser close.
-- Matches Duane's 20260522105706_persist_step_inputs migration.

ALTER TABLE srp_pipeline.sessions
  ADD COLUMN IF NOT EXISTS reel_guidance        JSONB,  -- {0: "...", 1: "..."} per reel index
  ADD COLUMN IF NOT EXISTS sunday_invite_input  JSONB,  -- {guidance, selected_idx, selected_citation, selected_tags}
  ADD COLUMN IF NOT EXISTS facebook_input       JSONB,  -- {guidance, selected_idx, selected_citation, selected_tags}
  ADD COLUMN IF NOT EXISTS carousel_input       JSONB,  -- {slides_guidance, caption_guidance, selected_idx, selected_citations, selected_tags}
  ADD COLUMN IF NOT EXISTS photo_recap_input    JSONB;  -- {category, guidance, selected_idx, selected_tags}
