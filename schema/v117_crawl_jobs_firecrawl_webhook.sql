-- v117 — Firecrawl webhook architecture
--
-- The old design polled Firecrawl synchronously from inside
-- fire-crawl-trigger:
--   POST /v1/crawl → loop GET /v1/crawl/{id} every 5s until done.
-- Each Firecrawl crawl could take up to 5 minutes; the function's
-- max wait was 300 s per call. Multi-call flows (initial + repeat-
-- prefix expand + stealth retries) routinely blew past Supabase's
-- ~400-second edge-function timeout, leaving crawl_jobs stuck
-- in_progress and the function silently dead. Doxology's multi-
-- campus crawl made this fatal — three subdomains × 5 min each
-- pinned the function past timeout every time.
--
-- The fix moves Firecrawl to WEBHOOK MODE. fire-crawl-trigger now
-- just kicks off the crawl and returns in ~1-2 s; Firecrawl callbacks
-- the new firecrawl-webhook function when the crawl completes.
-- No polling. No edge-function timeout. Any number of seeds runs
-- in parallel without starving each other.
--
-- This column records the Firecrawl-side crawl id so the webhook
-- can find its crawl_job row when the callback lands.

ALTER TABLE "web-hub".crawl_jobs
  ADD COLUMN IF NOT EXISTS firecrawl_crawl_id text;

CREATE INDEX IF NOT EXISTS crawl_jobs_firecrawl_id_idx
  ON "web-hub".crawl_jobs (firecrawl_crawl_id)
  WHERE firecrawl_crawl_id IS NOT NULL;

COMMENT ON COLUMN "web-hub".crawl_jobs.firecrawl_crawl_id IS
  'Firecrawl-side crawl id. Set by fire-crawl-trigger after POST /v1/crawl. Used by firecrawl-webhook to correlate inbound callbacks with the right job. NULL on legacy polled jobs.';
