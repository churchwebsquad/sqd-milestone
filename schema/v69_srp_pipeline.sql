-- ============================================================
-- v69: SRP Pipeline schema additions (ADDITIVE — DDL only)
--
-- The `srp_pipeline` schema already exists on squad-data with all 6
-- tables, the update_updated_at function, triggers, RLS, realtime
-- publication for transcript_jobs + clipcutter_jobs, and 3 seeded
-- admins (ashley/amber/duane). It was created when srp-generator-main
-- was originally deployed against this database.
--
-- This migration adds only what the milestone-comms-app SRP port
-- needs beyond what already exists:
--   1. sessions.srp_task_id_override   — ClickUp blocker-dependency manual override
--   2. clip_templates.brand_voice_guidelines — per-account brand voice
--      (writes from AccountSelection step's textarea; replaces the
--       srp-generator-main pattern of writing back to
--       strategy_account_progress, which the CLAUDE.md rules forbid)
--   3. 10 performance indexes I planned in the original v69 design
--
-- All adds use IF NOT EXISTS — safe to re-run.
-- See docs/SRP_PORT_PLAN.md for the full port plan.
-- ============================================================

-- ---------- New columns ----------

ALTER TABLE srp_pipeline.sessions
  ADD COLUMN IF NOT EXISTS srp_task_id_override TEXT;

COMMENT ON COLUMN srp_pipeline.sessions.srp_task_id_override IS
  'Manual ClickUp task ID override when n8n cannot resolve the SRP Video child task via blocker dependency. Set from the MissingBlockerTaskDialog UI.';

ALTER TABLE srp_pipeline.clip_templates
  ADD COLUMN IF NOT EXISTS brand_voice_guidelines TEXT;

COMMENT ON COLUMN srp_pipeline.clip_templates.brand_voice_guidelines IS
  'Per-account brand voice guidelines. Writes from the AccountSelection step. Replaces the srp-generator-main pattern of writing back to strategy_account_progress.brand_voice_guidelines (forbidden by CLAUDE.md).';

-- ---------- Performance indexes ----------

CREATE INDEX IF NOT EXISTS sessions_member_idx          ON srp_pipeline.sessions (member);
CREATE INDEX IF NOT EXISTS sessions_user_email_idx      ON srp_pipeline.sessions (user_email);
CREATE INDEX IF NOT EXISTS sessions_status_idx          ON srp_pipeline.sessions (status);
CREATE INDEX IF NOT EXISTS sessions_updated_at_idx      ON srp_pipeline.sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_clickup_task_idx    ON srp_pipeline.sessions (clickup_task_id);

CREATE INDEX IF NOT EXISTS transcript_jobs_session_idx  ON srp_pipeline.transcript_jobs (session_id);
CREATE INDEX IF NOT EXISTS transcript_jobs_status_idx   ON srp_pipeline.transcript_jobs (status);

CREATE INDEX IF NOT EXISTS clipcutter_jobs_session_idx  ON srp_pipeline.clipcutter_jobs (session_id);
CREATE INDEX IF NOT EXISTS clipcutter_jobs_status_idx   ON srp_pipeline.clipcutter_jobs (status);

CREATE INDEX IF NOT EXISTS clip_templates_member_idx    ON srp_pipeline.clip_templates (member);

-- ============================================================
-- Done.
-- ============================================================
