-- v110 — Schedule auto-sync-all-strategy-briefs on pg_cron
--
-- The sweeper walks every Strategy Brief in the All-In Documents
-- Notion database (Doc Type="Strategy Brief"), matches by Member #
-- rollup against active web projects, and syncs new + freshly-edited
-- briefs into web_intake_documents. Idempotent — already-up-to-date
-- briefs are skipped via notion_last_edited_at comparison.
--
-- Cadence: every 15 minutes. Cap of 25 syncs per run (set in the
-- function body) prevents Claude/Notion budget burn if a backlog
-- accumulates; the next pass picks up where this one left off.
--
-- Auth: the function has verify_jwt=false (matching the rest of
-- strategy-notion), so the cron's net.http_post call doesn't need
-- an Authorization header. Body is empty — the op takes no args.

DO $$
BEGIN
  PERFORM cron.unschedule('strategy-brief-auto-sync')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'strategy-brief-auto-sync');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'strategy-brief-auto-sync',
  '*/15 * * * *',
  $job$
    SELECT net.http_post(
      url     := 'https://wttgwoxlezqoyzmesekt.supabase.co/functions/v1/strategy-notion',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('op', 'auto-sync-all-strategy-briefs')
    )
  $job$
);
