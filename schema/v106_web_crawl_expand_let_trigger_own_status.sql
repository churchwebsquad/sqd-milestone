-- v106 — web_crawl_expand stops pre-emptively writing status
--
-- Bug found while debugging Mountain Life: even after v103 made the
-- RPC tolerant of stuck rows, "Crawl more pages" still wasn't firing.
-- Tracer revealed the RPC and fire-crawl-trigger were both trying to
-- own crawl_jobs.status during an expand, and they conflicted:
--
--   1. AM clicks "Crawl more pages"
--   2. RPC finds the prior 'complete' row.
--   3. RPC UPDATEs status='in_progress' on that row.   ← culprit
--   4. RPC fires net.http_post to fire-crawl-trigger.
--   5. fire-crawl-trigger reads the row, sees status='in_progress'
--      (NOT 'complete'), returns 409 "expand_into_job is not
--      complete — wait for the prior crawl first".
--   6. The expand never starts. Row sits at in_progress until the
--      reconciler sweeper (v104) recovers it on the next pass.
--
-- Fix: drop the RPC's status UPDATE. fire-crawl-trigger ALREADY
-- updates the row to in_progress when it accepts the expand request
-- (in the existingJob branch around the "Failed to mark expand job
-- in_progress" comment). The trigger is the single authority on
-- crawl_jobs.status during a crawl; the RPC just hands off.

CREATE OR REPLACE FUNCTION public.web_crawl_expand(p_web_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  proj         strategy_web_projects;
  cfg          web_crawl_config;
  latest_job   "web-hub".crawl_jobs%ROWTYPE;
  request_body jsonb;
BEGIN
  SELECT * INTO proj FROM strategy_web_projects WHERE id = p_web_project_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Project not found');
  END IF;

  -- Find the latest job whose crawl actually delivered pages. Prefer
  -- a row currently at status='complete' so fire-crawl-trigger's
  -- guard (line: "expand_into_job is not complete") passes. The v104
  -- reconciler sweeper keeps this state honest — if a callback
  -- failure left a row stuck, the sweeper soft-recovers it within
  -- the next 5 minutes.
  SELECT * INTO latest_job
  FROM "web-hub".crawl_jobs
  WHERE project_id = proj.id
    AND status = 'complete'
  ORDER BY completed_at DESC NULLS LAST, started_at DESC
  LIMIT 1;

  -- Soft fallback: if no row is currently 'complete' but at least one
  -- row has crawl_results, surface a hint that the reconciler should
  -- clean it up shortly. We still bail rather than try to expand —
  -- the trigger's 409 check is the correct safety against attaching
  -- a new expand to a row that's mid-flight.
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM "web-hub".crawl_jobs
      WHERE project_id = proj.id
        AND jsonb_array_length(COALESCE(crawl_results, '[]'::jsonb)) > 0
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'A prior crawl produced pages but its status is not "complete" yet (possibly mid-reconciliation). Try again in a few minutes; the sweeper runs every 5.'
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'No completed crawl found. Run an initial crawl first; expansion only applies on top of existing data.'
    );
  END IF;

  SELECT * INTO cfg FROM web_crawl_config WHERE id = 1;

  -- IMPORTANT: do NOT update status='in_progress' here. fire-crawl-
  -- trigger reads the row, requires status='complete', and writes
  -- in_progress itself once it accepts. Pre-empting that update
  -- caused v103's symptom (the trigger's 409 + a stuck row).

  request_body := jsonb_build_object(
    'project_id',           proj.id::text,
    'target_url',           latest_job.target_url,
    'max_pages',            COALESCE(cfg.max_pages, 25),
    'max_depth',            COALESCE(cfg.max_depth, 2),
    'expand_into_job_id',   latest_job.id::text
  );

  PERFORM net.http_post(
    url     := cfg.edge_fn_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || cfg.anon_jwt
    ),
    body    := request_body
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expanded_job_id', latest_job.id,
    'existing_pages', COALESCE(jsonb_array_length(latest_job.crawl_results), 0)
  );
END;
$$;
