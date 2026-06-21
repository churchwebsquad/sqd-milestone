-- v79 — Manual planning status + reason fields.
--
-- The planning surface needs a way for AMs to flag a project as
-- "waiting on partner / blocked / paused" with a reason that
-- outlives the next health computation. computeProjectHealth always
-- derives a sub_status from data; these columns are the manual
-- *override* lane, surfaced as such in the UI.
--
-- All columns are nullable + additive (ADD COLUMN IF NOT EXISTS).
-- Dependency audit (2026-06-20): two triggers on the table touch
-- only NEW.id + NEW.member; sixteen FKs reference the PK only; no
-- views or matviews reference the table; six RLS policies do not
-- enumerate columns. Safe.

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS manual_sub_status        text,
  ADD COLUMN IF NOT EXISTS status_reason            text,
  ADD COLUMN IF NOT EXISTS status_changed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by        text,
  ADD COLUMN IF NOT EXISTS stalled_dismissed_until  timestamptz;

COMMENT ON COLUMN strategy_web_projects.manual_sub_status IS
  'AM-set override that beats the computed sub_status. Values: in_progress | waiting_partner | blocked | paused | NULL (= use computed). When set, projection treats the project as paused so dev capacity frees up.';

COMMENT ON COLUMN strategy_web_projects.status_reason IS
  'Human-readable reason the manual_sub_status was set. Surfaces in the needs-attention digest and risk panel.';

COMMENT ON COLUMN strategy_web_projects.status_changed_at IS
  'When manual_sub_status was last changed. Auto-stamped from the UI.';

COMMENT ON COLUMN strategy_web_projects.status_changed_by IS
  'employee_id of the user who set manual_sub_status. Auto-stamped from the UI.';

COMMENT ON COLUMN strategy_web_projects.stalled_dismissed_until IS
  'When a stall warning was dismissed by a user, the timestamp the dismissal expires. Lets the user silence a known-slow step without losing the signal forever.';
