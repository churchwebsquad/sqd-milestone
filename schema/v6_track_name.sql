-- ============================================================================
-- v6_track_name.sql
-- Add track_name column to strategy_milestone_submissions
-- Used to distinguish multiple parallel tracks within a pathway — e.g.,
-- Ministry Subbrand lets a church run several named subbrands at once
-- ("Kids Ministry", "Youth", "Women's"), each with its own milestone progression.
-- Null for pathways that don't need multi-track support.
-- ============================================================================

ALTER TABLE strategy_milestone_submissions
  ADD COLUMN IF NOT EXISTS track_name text;

COMMENT ON COLUMN strategy_milestone_submissions.track_name IS
  'Optional track label within a pathway (e.g. "Kids Ministry" for a ministry_subbrand). NULL for single-track pathways.';

-- Index to speed up portal/log lookups that group by (member, track_name)
CREATE INDEX IF NOT EXISTS idx_strategy_milestone_submissions_member_track
  ON strategy_milestone_submissions (member, track_name);
