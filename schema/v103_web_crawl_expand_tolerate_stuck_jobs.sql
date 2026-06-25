-- v103 — web_crawl_expand now tolerates stuck "in_progress" jobs
--
-- Bug: when a prior "Crawl more pages" call updated status to
-- 'in_progress' and the fire-crawl-trigger callback failed to flip it
-- back to 'complete', the row was stuck. Subsequent expand calls fell
-- into the "No completed crawl found" branch even though the prior
-- crawl's results were sitting right there in crawl_results.
--
-- Fix: find the latest job whose crawl_results array is non-empty OR
-- status='complete', regardless of the current status. Either signal
-- indicates "a crawl actually delivered pages we can build on top of."
-- Then we still UPDATE status to 'in_progress' for the new expand
-- attempt, but we no longer require the prior status to be 'complete'
-- to find the job.

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

  -- Find the latest job whose crawl actually delivered pages, regardless
  -- of current status. Status='complete' is the happy path; non-empty
  -- crawl_results means a prior expand grabbed pages but got stuck at
  -- in_progress when the callback never flipped status back.
  SELECT * INTO latest_job
  FROM "web-hub".crawl_jobs
  WHERE project_id = proj.id
    AND (status = 'complete' OR jsonb_array_length(COALESCE(crawl_results, '[]'::jsonb)) > 0)
  ORDER BY completed_at DESC NULLS LAST, started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'No completed crawl found. Run an initial crawl first; expansion only applies on top of existing data.'
    );
  END IF;

  SELECT * INTO cfg FROM web_crawl_config WHERE id = 1;

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
