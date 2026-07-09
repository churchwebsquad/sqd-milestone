-- v82: Auto-processing jobs for SRP webhook pipeline
-- Created when ClickUp fires a taskTagUpdated event for sms-sermon-recap.
-- Tracks video discovery + transcription status per church per week so
-- the Social Hub can show a status badge without waiting for an SMM to
-- manually start the workflow.

CREATE TABLE IF NOT EXISTS strategy.srp_auto_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member           INTEGER NOT NULL,
  clickup_task_id  TEXT NOT NULL,
  week_start       DATE NOT NULL,          -- Friday that started this Fri–Thu work week
  video_url        TEXT,                   -- sermon video URL once found
  video_status     TEXT NOT NULL DEFAULT 'pending',
    -- pending | found | waiting_for_upload | error
  video_error      TEXT,                   -- human-readable error if video_status = error
  session_id       TEXT,                   -- srp_pipeline.sessions.session_id (auto-created)
  transcript_status TEXT NOT NULL DEFAULT 'pending',
    -- pending | in_progress | ready | error | skipped
  transcript_job_id TEXT,                  -- srp_pipeline.transcript_jobs.id
  triggered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One auto-job per church per week
  UNIQUE (member, week_start)
);

CREATE INDEX IF NOT EXISTS idx_srp_auto_jobs_week
  ON strategy.srp_auto_jobs (week_start DESC);

CREATE INDEX IF NOT EXISTS idx_srp_auto_jobs_member
  ON strategy.srp_auto_jobs (member);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION strategy.srp_auto_jobs_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_srp_auto_jobs_updated_at ON strategy.srp_auto_jobs;
CREATE TRIGGER trg_srp_auto_jobs_updated_at
  BEFORE UPDATE ON strategy.srp_auto_jobs
  FOR EACH ROW EXECUTE FUNCTION strategy.srp_auto_jobs_set_updated_at();
