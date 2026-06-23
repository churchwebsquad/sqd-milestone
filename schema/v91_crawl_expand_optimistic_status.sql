-- v91 — Crawl expand: optimistically flip job to in_progress before
-- firing the edge function so the CrawlWorkspace's watching UI sees
-- the expand has started.
--
-- Bug: web_crawl_expand returned ok=true without updating the job's
-- status. The frontend loaded crawl_jobs, saw status='complete' (the
-- prior run's terminal state), and the auto-poll terminator
-- immediately cleared `watching` — so the in-progress banner never
-- appeared even though the edge function eventually picked up the
-- request and ran the crawl. Result: user thinks "crawl more pages"
-- is broken.
--
-- Fix: stamp the job as `in_progress` inside the RPC BEFORE the
-- http_post, so the next load() the frontend runs sees the right
-- status and the watching banner shows up.

CREATE OR REPLACE FUNCTION web_crawl_expand(p_web_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

  SELECT * INTO latest_job
  FROM "web-hub".crawl_jobs
  WHERE project_id = proj.id AND status = 'complete'
  ORDER BY completed_at DESC NULLS LAST, started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'No completed crawl found. Run an initial crawl first; expansion only applies on top of existing data.'
    );
  END IF;

  SELECT * INTO cfg FROM web_crawl_config WHERE id = 1;

  -- Optimistic status flip so the frontend's watching UI shows the
  -- expand is running. The edge function will reaffirm in_progress
  -- when it picks up the request a moment later, then flip to
  -- 'complete' (or 'failed') on its own.
  UPDATE "web-hub".crawl_jobs
  SET status = 'in_progress',
      error_message = NULL
  WHERE id = latest_job.id;

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
