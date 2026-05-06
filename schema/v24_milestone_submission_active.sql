-- v24_milestone_submission_active.sql
--
-- Soft-delete for milestone submissions. Adds an `is_active` flag so
-- staff can archive incorrect submissions (wrong partner, wrong
-- milestone, accidental send) without hard-deleting the row + losing
-- the audit trail. Archived rows are filtered out of:
--
--   - the partner-facing portal
--   - the submission workflow's continuation lookup + recap
--   - the milestone-status / dashboard rollups
--   - the reply-scrub cron's active set
--
-- Staff can still see archived rows on the per-partner Account Log
-- (behind a "Show archived" toggle) and restore them with one click.

ALTER TABLE strategy_milestone_submissions
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN strategy_milestone_submissions.is_active IS
  'Soft-delete flag. Archived submissions (false) are hidden from the partner portal, dashboards, continuation lookups, and the reply-scrub cron, but still visible to staff via the AccountLog "Show archived" toggle for restore.';

-- Partial index — most reads are scoped to active rows, so an
-- expression index lets the planner skip the dead set entirely.
CREATE INDEX IF NOT EXISTS idx_strategy_milestone_submissions_active_member
  ON strategy_milestone_submissions (member, submitted_at DESC)
  WHERE is_active = true;
