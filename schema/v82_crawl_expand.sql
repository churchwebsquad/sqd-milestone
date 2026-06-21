-- v82 — `Crawl more pages` mode.
--
-- Use case (CityBridge community church, 2026-06-21): the initial
-- crawl's page cap was eaten by post-detail enumeration under slugs
-- like /kids-resources/*, /women-bible-study-messages/*, /mbs-
-- messages/*. Core pages (staff, volunteers, ministry overviews)
-- didn't make it. Re-crawling would lose the inventory we already
-- built; the strategist wants to EXPAND the crawl with new pages
-- while excluding the slugs already grabbed.
--
-- The flow:
--   1. UI button "Crawl more pages" calls web_crawl_expand(project_id).
--   2. The RPC pulls the latest completed crawl_jobs row + invokes
--      fire-crawl-trigger with `expand_into_job_id` set.
--   3. fire-crawl-trigger reads the existing crawl_results, builds
--      excludePaths from every URL grabbed (exact-match regex) plus
--      a wildcard exclude for every path prefix with ≥2 pages, then
--      runs Firecrawl. New pages get APPENDED to the existing job's
--      crawl_results (dedupe by URL).
--   4. crawl-categorize re-runs against the merged set on next invoke.

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

GRANT EXECUTE ON FUNCTION public.web_crawl_expand(uuid) TO authenticated;
