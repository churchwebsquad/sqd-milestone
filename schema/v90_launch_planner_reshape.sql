-- v90 — Launch planner reshape.
--
-- Replaces the page-count × Novamira × per-project-assist hours
-- system with the prototype's flat planned_dev_hours + per-week
-- org-wide help-hours model. User's call: most of what we had isn't
-- working; clean house.
--
-- Per the org rule "no new tables this round," strategy_dev_weekly_-
-- allocations is REPURPOSED from per-project hour pinning to
-- org-wide week adjustments (help_hours / designer_out / is_blackout).
-- The table was already empty after the earlier stale-row cleanup.
--
-- Dep audit done before applying: 0 functions/RPCs reference any of
-- the dropped strategy_web_projects columns. The allocations table
-- has one set_updated_at trigger (kept) and one FK on web_project_id
-- (dropped with the column).

-- ─── strategy_web_projects ───────────────────────────────────────

ALTER TABLE strategy_web_projects
  DROP COLUMN IF EXISTS expected_page_count,
  DROP COLUMN IF EXISTS dev_hours_per_page,
  DROP COLUMN IF EXISTS uses_novamira,
  DROP COLUMN IF EXISTS dev_edits_route_to_designer,
  DROP COLUMN IF EXISTS assist_hours_per_week_extra,
  DROP COLUMN IF EXISTS pre_dev_complete,
  DROP COLUMN IF EXISTS phase_estimates,
  DROP COLUMN IF EXISTS phase_progress,
  DROP COLUMN IF EXISTS manual_remaining_hours,
  DROP COLUMN IF EXISTS status_note,
  DROP COLUMN IF EXISTS ai_assist_multipliers;

ALTER TABLE strategy_web_projects
  ADD COLUMN IF NOT EXISTS tracked_hours          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_complete           numeric,
  ADD COLUMN IF NOT EXISTS recovery_mode          text NOT NULL DEFAULT 'designer',
  ADD COLUMN IF NOT EXISTS hard_deadline          date,
  ADD COLUMN IF NOT EXISTS clickup_build_task_id  text,
  ADD COLUMN IF NOT EXISTS dev_hours_source       text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_synced_at         timestamptz;

ALTER TABLE strategy_web_projects
  DROP CONSTRAINT IF EXISTS strategy_web_projects_recovery_mode_check,
  ADD CONSTRAINT  strategy_web_projects_recovery_mode_check
    CHECK (recovery_mode IN ('designer','dev-only')),
  DROP CONSTRAINT IF EXISTS strategy_web_projects_dev_hours_source_check,
  ADD CONSTRAINT  strategy_web_projects_dev_hours_source_check
    CHECK (dev_hours_source IN ('manual','clickup'));

COMMENT ON COLUMN strategy_web_projects.tracked_hours IS
  'Sum of time entries on the ClickUp Build Phase milestone subtree. Populated by clickupBuildPhase sync; 0 until synced.';
COMMENT ON COLUMN strategy_web_projects.pct_complete IS
  '0..1 progress fraction. Optional; drives the "projected total" pace projection. Falls back to tracked_hours / dev_hours_estimate when null.';
COMMENT ON COLUMN strategy_web_projects.recovery_mode IS
  '"designer" = a second person can pick up review-cycle edits / image uploads to recover a behind-target launch. "dev-only" = recovery requires the developer; date stands.';
COMMENT ON COLUMN strategy_web_projects.hard_deadline IS
  'Optional immovable date (event-driven). Surfaced as a red flag if the projected launch crosses it.';
COMMENT ON COLUMN strategy_web_projects.clickup_build_task_id IS
  'ClickUp task id for the "Redesign: Build Phase" milestone task. Source for tracked_hours sync.';
COMMENT ON COLUMN strategy_web_projects.dev_hours_source IS
  '"manual" = strategist typed dev_hours_estimate. "clickup" = rolled up from the Build Phase task at last_synced_at.';

-- ─── strategy_dev_weekly_allocations — repurpose ─────────────────
-- Was: per-project per-week hour pinning (priority='primary'/etc).
-- Now: per-week org-wide adjustments to the launch scheduler.
--      One row per affected week, keyed by week_starting (date).

ALTER TABLE strategy_dev_weekly_allocations
  DROP CONSTRAINT IF EXISTS strategy_dev_weekly_allocatio_week_starting_web_project_id__key,
  DROP CONSTRAINT IF EXISTS strategy_dev_weekly_allocations_slot_check,
  DROP CONSTRAINT IF EXISTS strategy_dev_weekly_allocations_web_project_id_fkey;

ALTER TABLE strategy_dev_weekly_allocations
  DROP COLUMN IF EXISTS web_project_id,
  DROP COLUMN IF EXISTS hours,
  DROP COLUMN IF EXISTS slot;

ALTER TABLE strategy_dev_weekly_allocations
  ADD COLUMN IF NOT EXISTS help_hours    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS designer_out  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_blackout   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reason        text;

ALTER TABLE strategy_dev_weekly_allocations
  ADD CONSTRAINT strategy_dev_weekly_allocations_week_starting_unique
    UNIQUE (week_starting);

COMMENT ON TABLE strategy_dev_weekly_allocations IS
  'Per-week org-wide adjustments to the launch scheduler. One row per Monday-start affected week. help_hours add capacity on top of the developer''s locked 35h base; designer_out zeros help for that week; is_blackout zeros total capacity (Christmas, etc.).';
COMMENT ON COLUMN strategy_dev_weekly_allocations.week_starting IS
  'Monday (UTC) of the affected week. UNIQUE — one adjustment row per week.';
COMMENT ON COLUMN strategy_dev_weekly_allocations.help_hours IS
  'Extra second-person hours on top of the locked 35h dev cap. Only applied when designer_out = false. Adding help pulls launches earlier; never delays them.';
COMMENT ON COLUMN strategy_dev_weekly_allocations.designer_out IS
  'When true, help_hours is ignored for that week — no one to offload to. Sites flagged dev-only ignore help_hours regardless.';
COMMENT ON COLUMN strategy_dev_weekly_allocations.is_blackout IS
  'When true, effective capacity is 0 that week (Christmas break, conference, etc.).';
