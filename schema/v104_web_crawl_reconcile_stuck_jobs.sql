-- v104 — Crawl reconciliation sweeper + 5-minute pg_cron schedule
-- (initial cut used 'abandoned' status which doesn't satisfy the
-- crawl_jobs_status_check constraint — patched in v104b to use 'failed'
-- with an audit-note sentinel in error_message).
--
-- Background: the fire-crawl-trigger callback occasionally fails to
-- flip a crawl_jobs row from 'in_progress' back to 'complete' after
-- the crawl actually finishes. The data lands in crawl_results +
-- completed_at gets set, but status sticks at 'in_progress' — and
-- every downstream surface that reads "is the crawl ready?" stays
-- blocked until someone manually resets the row.
--
-- The web_crawl_expand RPC's v103 tolerance fix masks this at the
-- expand call site, but every OTHER surface that asks "is the crawl
-- complete?" still gets the wrong answer. This sweeper is the
-- janitorial cleanup that runs every 5 minutes and reconciles state
-- across the table.
--
-- Two recovery paths:
--   (a) Soft-recover: row has completed_at + non-empty crawl_results
--       but stuck status. Flip to 'complete' in place. Cost: zero.
--       This is the dominant case.
--   (b) Mark failed: row has no data + started_at past threshold.
--       Flip to 'failed' with an "auto-reconciled" sentinel in
--       error_message. DOES NOT auto-fire a fresh crawl — that costs
--       Firecrawl credits and the AM should make the retry call (via
--       the existing per-project web_crawl_retry_if_stuck RPC or the
--       CrawlWorkspace UI).

CREATE OR REPLACE FUNCTION public.web_crawl_reconcile_stuck_jobs(
  p_stuck_after_minutes int DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, "web-hub"
AS $$
DECLARE
  soft_recovered_count int := 0;
  marked_failed_count  int := 0;
BEGIN
  -- Pass 1: soft-recover. Status got stuck but the data is there.
  WITH soft_recovered AS (
    UPDATE "web-hub".crawl_jobs
    SET    status = 'complete'
    WHERE  status = 'in_progress'
      AND  completed_at IS NOT NULL
      AND  jsonb_array_length(COALESCE(crawl_results, '[]'::jsonb)) > 0
    RETURNING id
  )
  SELECT COUNT(*) INTO soft_recovered_count FROM soft_recovered;

  -- Pass 2: mark genuinely stuck (no data, past threshold) as failed.
  -- error_message gets a sentinel so the AM can see this row was
  -- auto-reconciled (not failed for an upstream reason).
  WITH marked AS (
    UPDATE "web-hub".crawl_jobs
    SET    status = 'failed',
           error_message = NULLIF(TRIM(BOTH ' | ' FROM
             COALESCE(error_message, '') ||
             CASE WHEN COALESCE(error_message, '') = '' THEN '' ELSE ' | ' END ||
             'auto-reconciled: stuck in_progress past ' || p_stuck_after_minutes || 'm at ' || now()::text
           ), '')
    WHERE  status = 'in_progress'
      AND  started_at < now() - (p_stuck_after_minutes || ' minutes')::interval
      AND  jsonb_array_length(COALESCE(crawl_results, '[]'::jsonb)) = 0
    RETURNING id
  )
  SELECT COUNT(*) INTO marked_failed_count FROM marked;

  RETURN jsonb_build_object(
    'ok',                    true,
    'ran_at',                now(),
    'soft_recovered_count',  soft_recovered_count,
    'marked_failed_count',   marked_failed_count,
    'stuck_after_minutes',   p_stuck_after_minutes
  );
END;
$$;

COMMENT ON FUNCTION public.web_crawl_reconcile_stuck_jobs(int) IS
  'Janitorial sweeper for "web-hub".crawl_jobs. Soft-recovers rows where the crawl actually finished but status got stuck, and marks genuinely-stuck rows as failed with an audit-note sentinel. Runs every 5 minutes via pg_cron job "web-crawl-reconcile-stuck".';

-- Schedule the sweeper. Drop any prior entry first so re-running the
-- migration is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('web-crawl-reconcile-stuck')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'web-crawl-reconcile-stuck');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'web-crawl-reconcile-stuck',
  '*/5 * * * *',
  $job$SELECT public.web_crawl_reconcile_stuck_jobs(15)$job$
);
