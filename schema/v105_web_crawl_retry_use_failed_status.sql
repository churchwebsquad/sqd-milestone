-- v105 — fix web_crawl_retry_if_stuck to use 'failed' instead of 'abandoned'
--
-- The existing function tried SET status='abandoned' on the stuck-row
-- branch, which violates crawl_jobs_status_check (allows only pending /
-- in_progress / complete / failed). Any caller that actually hit the
-- "stuck → retry" branch would have errored on the UPDATE. Same fix
-- as v104 for the new reconciler: use 'failed' with an audit note in
-- error_message so the row is distinguishable from organic failures.

CREATE OR REPLACE FUNCTION public.web_crawl_retry_if_stuck(p_web_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  proj         strategy_web_projects;
  prog         strategy_account_progress;
  last_crawl   record;
  resolved_url text;
  fire_result  jsonb;
  STUCK_AFTER_MIN constant int := 15;
BEGIN
  SELECT * INTO proj FROM strategy_web_projects WHERE id = p_web_project_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Project not found');
  END IF;

  SELECT * INTO prog FROM strategy_account_progress WHERE member = proj.member LIMIT 1;
  resolved_url := prog.church_website;
  IF resolved_url IS NULL OR length(trim(resolved_url)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'action', 'error', 'reason', 'no_url');
  END IF;

  SELECT id, status, started_at, completed_at
    INTO last_crawl
    FROM "web-hub".crawl_jobs
    WHERE project_id = p_web_project_id
    ORDER BY started_at DESC NULLS LAST
    LIMIT 1;

  -- No prior crawl → fire fresh
  IF NOT FOUND THEN
    DELETE FROM web_crawl_intent WHERE web_project_id = p_web_project_id;
    fire_result := public.web_crawl_fire_manual(p_web_project_id, resolved_url);
    RETURN jsonb_build_object('ok', true, 'action', 'retried', 'reason', 'no_prior_crawl', 'fire_result', fire_result);
  END IF;

  -- Already completed — nothing to do
  IF last_crawl.status = 'completed' OR last_crawl.status = 'complete' THEN
    RETURN jsonb_build_object('ok', true, 'action', 'skipped_completed');
  END IF;

  -- In progress and still within the timeout window — leave it alone
  IF last_crawl.status = 'in_progress'
     AND last_crawl.started_at IS NOT NULL
     AND last_crawl.started_at > now() - (STUCK_AFTER_MIN || ' minutes')::interval THEN
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'still_running',
      'started_at', last_crawl.started_at,
      'minutes_old', EXTRACT(epoch FROM (now() - last_crawl.started_at)) / 60
    );
  END IF;

  -- Stuck (in_progress > 15 min) or failed — mark failed with an audit
  -- note and retry. Status 'failed' satisfies crawl_jobs_status_check
  -- (the prior 'abandoned' value did not exist in the enum, so any
  -- caller actually reaching this branch hit a constraint violation).
  UPDATE "web-hub".crawl_jobs
    SET status = 'failed',
        error_message = NULLIF(TRIM(BOTH ' | ' FROM
          COALESCE(error_message, '') ||
          CASE WHEN COALESCE(error_message, '') = '' THEN '' ELSE ' | ' END ||
          'auto-reconciled: stuck → retry at ' || now()::text
        ), '')
    WHERE id = last_crawl.id;
  DELETE FROM web_crawl_intent WHERE web_project_id = p_web_project_id;

  fire_result := public.web_crawl_fire_manual(p_web_project_id, resolved_url);
  RETURN jsonb_build_object(
    'ok', true,
    'action', 'retried',
    'reason', CASE WHEN last_crawl.status = 'failed' THEN 'previous_failed' ELSE 'previous_stuck' END,
    'previous_crawl_id', last_crawl.id,
    'previous_started_at', last_crawl.started_at,
    'fire_result', fire_result
  );
END;
$$;
