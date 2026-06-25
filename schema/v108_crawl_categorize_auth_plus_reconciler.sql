-- v108 — explicit auth on crawl-categorize trigger + post-crawl reconciler
--
-- Eagle's Nest Church's crawl finished cleanly (61 pages, status='complete')
-- but topics never landed — the trg_chain_crawl_categorize trigger fires
-- net.http_post to crawl-categorize WITHOUT an Authorization header.
-- crawl-categorize has verify_jwt=true, so a no-auth call returns 401
-- silently. Most other recent crawls did populate topics, so the issue
-- is intermittent (likely pg_net retries or the function tolerates
-- unauth in some flows), but the trigger as written is racy.
--
-- Two fixes:
--   1. Trigger now reads anon_jwt from web_crawl_config and passes
--      Authorization: Bearer <jwt>. Mirrors the auth pattern used by
--      web_crawl_expand and fire-crawl-trigger.
--   2. New janitor public.web_crawl_categorize_reconcile() finds
--      complete crawls (in the last 30 days) whose project has 0
--      web_project_topics rows and re-fires crawl-categorize. Scheduled
--      every 10 minutes via pg_cron. Belt-and-suspenders against
--      another transient failure leaving a project stuck.

-- ── (1) Trigger w/ explicit auth ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_chain_crawl_categorize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, "web-hub"
AS $$
DECLARE
  cfg web_crawl_config;
BEGIN
  -- Only fire on the transition INTO 'complete' from a different status.
  IF NEW.status = 'complete' AND (OLD.status IS NULL OR OLD.status <> 'complete') THEN
    SELECT * INTO cfg FROM web_crawl_config WHERE id = 1;
    PERFORM net.http_post(
      url     := 'https://wttgwoxlezqoyzmesekt.supabase.co/functions/v1/crawl-categorize',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || COALESCE(cfg.anon_jwt, '')
      ),
      body    := jsonb_build_object(
        'project_id',   NEW.project_id::text,
        'crawl_job_id', NEW.id::text
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ── (2) Reconciler — finds + re-fires for projects with 0 topics ────
CREATE OR REPLACE FUNCTION public.web_crawl_categorize_reconcile(
  p_max_age_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, "web-hub"
AS $$
DECLARE
  cfg          web_crawl_config;
  refire_count int := 0;
  proj         record;
BEGIN
  SELECT * INTO cfg FROM web_crawl_config WHERE id = 1;
  IF cfg.anon_jwt IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'web_crawl_config.anon_jwt missing');
  END IF;

  -- Find projects whose latest 'complete' crawl populated crawl_results
  -- but never landed any web_project_topics. Caps at 5 per run so we
  -- don't blow Claude budget if something widespread breaks.
  FOR proj IN
    WITH latest_complete AS (
      SELECT DISTINCT ON (cj.project_id)
             cj.project_id, cj.id AS crawl_job_id, cj.completed_at
      FROM "web-hub".crawl_jobs cj
      WHERE cj.status = 'complete'
        AND jsonb_array_length(COALESCE(cj.crawl_results, '[]'::jsonb)) > 0
        AND cj.completed_at > now() - (p_max_age_days || ' days')::interval
      ORDER BY cj.project_id, cj.completed_at DESC NULLS LAST
    )
    SELECT lc.project_id, lc.crawl_job_id
    FROM latest_complete lc
    JOIN strategy_web_projects wp ON wp.id = lc.project_id
    WHERE wp.archived = false
      AND NOT EXISTS (
        SELECT 1 FROM web_project_topics t WHERE t.web_project_id = lc.project_id
      )
    LIMIT 5
  LOOP
    PERFORM net.http_post(
      url     := 'https://wttgwoxlezqoyzmesekt.supabase.co/functions/v1/crawl-categorize',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || cfg.anon_jwt
      ),
      body    := jsonb_build_object(
        'project_id',   proj.project_id::text,
        'crawl_job_id', proj.crawl_job_id::text
      )
    );
    refire_count := refire_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',           true,
    'ran_at',       now(),
    'refire_count', refire_count,
    'max_age_days', p_max_age_days
  );
END;
$$;

COMMENT ON FUNCTION public.web_crawl_categorize_reconcile(int) IS
  'Janitor for "crawl complete but no topics" — re-fires crawl-categorize for any project whose latest complete crawl never landed topics. Capped at 5 projects per run. Runs every 10 minutes via pg_cron job "web-crawl-categorize-reconcile".';

-- ── Schedule (idempotent) ───────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('web-crawl-categorize-reconcile')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'web-crawl-categorize-reconcile');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'web-crawl-categorize-reconcile',
  '*/10 * * * *',
  $job$SELECT public.web_crawl_categorize_reconcile(30)$job$
);
