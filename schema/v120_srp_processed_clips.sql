-- Per-clip render output table for srp_pipeline.
-- Written by srp-clipcutter-callback when n8n completes processing a single clip.
-- Status: 'processing' | 'ready' | 'error'

CREATE TABLE IF NOT EXISTS srp_pipeline.processed_clips (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        text        NOT NULL,
  clip_id           text        NOT NULL,
  clipcutter_job_id uuid,
  status            text        NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing', 'ready', 'error')),
  video_url         text,
  transcript        text,
  duration_ms       integer,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, clip_id)
);

ALTER TABLE srp_pipeline.processed_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated staff can manage processed clips"
  ON srp_pipeline.processed_clips
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE srp_pipeline.processed_clips;
