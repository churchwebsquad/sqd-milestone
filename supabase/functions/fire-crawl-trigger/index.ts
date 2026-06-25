// fire-crawl-trigger (v117) — async/webhook architecture.
//
// Kicks off a Firecrawl /v1/crawl in webhook mode and returns
// immediately. Firecrawl POSTs to firecrawl-webhook when the crawl
// completes; that function records the pages and chains the post-
// crawl pipeline (atomize, categorize, copy-fixing).
//
// Why this rewrite: the prior synchronous-polling design blocked
// the edge function for up to 5 minutes per Firecrawl call. Multi-
// step flows (initial + repeat-prefix expansion + stealth retries)
// routinely exceeded Supabase's ~400-second edge-function timeout,
// leaving crawl_jobs orphaned in_progress with no way for the
// downstream pipeline to know the crawl failed. Multi-campus
// (Doxology) made this fatal — three subdomains × 5 min each pinned
// the function past timeout every time.
//
// Body shape:
//   POST /functions/v1/fire-crawl-trigger
//   {
//     "project_id":  "<uuid>",
//     "target_url":  "https://example.org",
//     "max_pages":   25,             // optional
//     "max_depth":   2,              // optional
//     "proxy":       "basic"          // optional: 'basic' | 'stealth'
//   }
//
// Response: 202 Accepted with { crawl_job_id, firecrawl_crawl_id }.
// The webhook eventually fills crawl_results and flips status to
// 'complete'; the UI polls crawl_jobs to know when that happens.
//
// Multi-campus / multi-URL crawl is handled by callers firing this
// function once per URL. Each invocation creates its OWN crawl_job
// row; downstream consumers (atomize-crawl-into-atoms, crawl-
// categorize via trg_chain_crawl_categorize) already aggregate /
// partition across multiple jobs per project.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const DEFAULT_EXCLUDE_PATHS: string[] = [
  // Resource / static file extensions
  ".*\\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|mp3|mp4|webm|mov|woff2?|ttf|eot|css|js|xml|json)$",
  // Common admin / system paths
  "^/wp-admin/.*", "^/wp-login.*", "^/admin/.*", "^/login.*",
  // Tag / category / archive enumerations
  "^/(tag|tags|category|categories|author)/.*",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const fireKey     = Deno.env.get("FIRECRAWL_API_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "supabase_env_missing" }, 500);
  if (!fireKey) return json({ error: "firecrawl_key_missing" }, 500);

  let payload: {
    project_id?:   string;
    target_url?:   string;
    max_pages?:    number;
    max_depth?:    number;
    proxy?:        'basic' | 'stealth';
    exclude_paths?: string[];
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!payload.project_id || !payload.target_url) {
    return json({ error: "Missing required fields", required: ["project_id", "target_url"] }, 400);
  }

  const maxPages    = payload.max_pages ?? 50;
  const maxDepth    = payload.max_depth ?? 3;
  const proxyMode   = payload.proxy ?? 'basic';
  const excludePaths = Array.isArray(payload.exclude_paths) && payload.exclude_paths.length > 0
    ? payload.exclude_paths
    : DEFAULT_EXCLUDE_PATHS;

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1. Create the crawl_job row up-front so the UI can show "in_progress"
  //    while Firecrawl runs. firecrawl_crawl_id is filled in step 3 once
  //    we have it.
  const { data: insertedRaw, error: insErr } = await supabase
    .schema("web-hub").from("crawl_jobs")
    .insert({
      project_id:   payload.project_id,
      target_url:   payload.target_url,
      status:       "in_progress",
      pages_crawled: 0,
      max_pages:    maxPages,
      max_depth:    maxDepth,
      started_at:   new Date().toISOString(),
    })
    .select("id").single();
  if (insErr || !insertedRaw) {
    return json({ error: "create_crawl_job_failed", details: insErr?.message }, 500);
  }
  const crawlJobId = (insertedRaw as { id: string }).id;

  // 2. Build the webhook URL. Firecrawl will POST here when the
  //    crawl finishes. Auth is implicit: the webhook handler looks
  //    up the crawl_job by firecrawl_crawl_id, which is only set on
  //    rows we created.
  const webhookUrl = `${supabaseUrl}/functions/v1/firecrawl-webhook`;

  // 3. Start the Firecrawl crawl. This call returns in <1 s with
  //    just the crawl id; the actual crawl runs on Firecrawl's
  //    infrastructure.
  let firecrawlCrawlId: string | null = null;
  try {
    const startRes = await fetch("https://api.firecrawl.dev/v1/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${fireKey}` },
      body: JSON.stringify({
        url:                payload.target_url,
        limit:              maxPages,
        maxDepth,
        excludePaths,
        allowBackwardLinks: false,
        allowExternalLinks: false,
        scrapeOptions: {
          formats:         ["markdown", "html", "links"],
          // onlyMainContent:false keeps footer + header in the markdown
          // so the categorizer can pick up site-wide details (address,
          // phone, socials) that live in the chrome on most church sites.
          onlyMainContent: false,
          proxy:           proxyMode,
        },
        webhook: {
          url:    webhookUrl,
          events: ["completed", "failed"],
          // Future hardening: HMAC signature via webhook.secret.
        },
      }),
    });
    if (!startRes.ok) {
      const errText = await startRes.text();
      await supabase.schema("web-hub").from("crawl_jobs").update({
        status:        "failed",
        completed_at:  new Date().toISOString(),
        error_message: `Firecrawl start failed: ${errText.slice(0, 500)}`,
      }).eq("id", crawlJobId);
      return json({ error: "firecrawl_start_failed", status: startRes.status, details: errText }, 502);
    }
    const startData = await startRes.json();
    firecrawlCrawlId = (startData as { id?: string }).id ?? null;
    if (!firecrawlCrawlId) {
      await supabase.schema("web-hub").from("crawl_jobs").update({
        status:        "failed",
        completed_at:  new Date().toISOString(),
        error_message: "Firecrawl returned no crawl id",
      }).eq("id", crawlJobId);
      return json({ error: "firecrawl_no_id" }, 502);
    }
  } catch (e) {
    await supabase.schema("web-hub").from("crawl_jobs").update({
      status:        "failed",
      completed_at:  new Date().toISOString(),
      error_message: `Firecrawl start threw: ${e instanceof Error ? e.message : String(e)}`,
    }).eq("id", crawlJobId);
    return json({ error: "firecrawl_start_threw", details: e instanceof Error ? e.message : String(e) }, 502);
  }

  // 4. Record the Firecrawl crawl id so the webhook can find this job
  //    when the callback lands.
  await supabase.schema("web-hub").from("crawl_jobs").update({
    firecrawl_crawl_id: firecrawlCrawlId,
  }).eq("id", crawlJobId);

  // 5. Return immediately. Total time on this path: ~1-2 seconds.
  return json({
    success:            true,
    crawl_job_id:       crawlJobId,
    firecrawl_crawl_id: firecrawlCrawlId,
    target_url:         payload.target_url,
    message:            "Crawl started; webhook will deliver results.",
  }, 202);
});
