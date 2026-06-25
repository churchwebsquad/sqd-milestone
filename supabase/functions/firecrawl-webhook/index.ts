// firecrawl-webhook (v117) — Firecrawl callback receiver.
//
// fire-crawl-trigger now starts crawls in webhook mode and returns
// immediately. Firecrawl POSTs to this function when a crawl
// completes or fails. We look up the crawl_job by firecrawl_crawl_id
// (set by fire-crawl-trigger on start), write the pages, trigger the
// post-crawl chain.
//
// Why this exists at all: the prior synchronous polling design
// blocked the edge function for up to 5 minutes per Firecrawl crawl.
// Multi-step flows (initial + repeat-prefix expansion + stealth
// retry) routinely blew past Supabase's ~400 s timeout, leaving
// crawl_jobs orphaned in_progress and the function silently dead.
// Webhook mode removes the timeout class of failure entirely — each
// crawl is fire-and-forget, the webhook lands when it lands.
//
// Auth: verify_jwt:false (Firecrawl can't send our JWT). Implicit
// auth is "the firecrawl_crawl_id has to match a row we created" —
// since those IDs are server-generated UUIDs that only our crawl_job
// rows know about, an attacker would need to guess a valid one to
// affect any row. The worst-case spoof writes empty pages to a job;
// reversible via re-crawl.
//
// Body shape (from Firecrawl):
//   { type: "crawl.completed", id: "<crawl_id>", data: [...pages] }
//   { type: "crawl.failed",    id: "<crawl_id>", error: "..."     }
//   (crawl.started / crawl.page also arrive but we ignore them)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  extractSnippets,
  isScrapeFailure,
  normalizePage,
  upsertSnippets,
  type CrawlPage,
} from "../_shared/firecrawlPostProcess.ts";

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

interface FirecrawlWebhookPayload {
  type?:    string;
  id?:      string;
  data?:    CrawlPage[];
  error?:   string;
  success?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body: FirecrawlWebhookPayload;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const eventType = body.type ?? "";
  const firecrawlCrawlId = body.id ?? "";

  // Only act on terminal events. Firecrawl also emits crawl.started
  // and per-page crawl.page events; we don't care about those.
  if (eventType !== "crawl.completed" && eventType !== "crawl.failed") {
    return json({ ok: true, ignored: eventType }, 200);
  }
  if (!firecrawlCrawlId) {
    return json({ error: "missing_id" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Implicit auth: the firecrawl_crawl_id must match a row we created.
  // If no row matches, this is either a stale callback for a deleted
  // job or a spoofed request — either way, ignore.
  const { data: job, error: jobErr } = await supabase
    .schema("web-hub")
    .from("crawl_jobs")
    .select("id, project_id, target_url, status, crawl_results")
    .eq("firecrawl_crawl_id", firecrawlCrawlId)
    .maybeSingle();
  if (jobErr) {
    console.error("[firecrawl-webhook] crawl_job lookup failed:", jobErr.message);
    return json({ error: "lookup_failed" }, 500);
  }
  if (!job) {
    console.warn("[firecrawl-webhook] no crawl_job matches firecrawl_crawl_id:", firecrawlCrawlId);
    return json({ ok: true, ignored: "unknown_job" }, 200);
  }

  // ── crawl.failed: record the failure + bail ─────────────────────
  if (eventType === "crawl.failed") {
    await supabase
      .schema("web-hub")
      .from("crawl_jobs")
      .update({
        status:        "failed",
        completed_at:  new Date().toISOString(),
        error_message: body.error ?? "Firecrawl reported failure",
      })
      .eq("id", (job as { id: string }).id);
    return json({ ok: true, recorded: "failed" }, 200);
  }

  // ── crawl.completed: filter failures, normalize, snippet, store ─
  const rawPages = Array.isArray(body.data) ? body.data : [];
  const droppedFailures: Array<{ url: string; statusCode?: number; error?: string }> = [];
  const okPages: CrawlPage[] = [];
  for (const r of rawPages) {
    if (isScrapeFailure(r)) {
      droppedFailures.push({
        url:        r.url ?? r.metadata?.sourceURL ?? "",
        statusCode: r.metadata?.statusCode,
        error:      r.metadata?.error,
      });
      continue;
    }
    okPages.push(r);
  }

  // NOTE: the prior polled flow did a stealth-proxy retry pass for
  // failures here (up to 50 URLs × ~30 s each). We skip that in v117
  // because chaining /v1/scrape calls synchronously runs us back into
  // the edge-fn timeout. A future enhancement spawns a separate
  // edge-fn invocation per stealth retry so they're each their own
  // budget. For now: a meaningful failure rate just produces a
  // shorter inventory; staff can re-fire with proxy:'stealth' via
  // the upcoming payload flag.

  const contentItems = okPages.map(normalizePage).filter(p => p.url);
  const projectId = (job as { project_id: string }).project_id;
  const targetUrl = (job as { target_url: string }).target_url;

  // Snippet extraction (best-effort, soft-fail).
  try {
    const snippets = extractSnippets(contentItems, targetUrl);
    if (snippets.length > 0) await upsertSnippets(supabase, projectId, snippets);
  } catch (e) {
    console.error("[firecrawl-webhook] snippet extract failed:", e instanceof Error ? e.message : e);
  }

  // Webhook mode is one-shot per crawl_job — we OVERWRITE crawl_results
  // rather than merge. (Prior expand-into-existing-job pattern is
  // gone; multi-step crawls now use multiple crawl_job rows.)
  const errorMessage = droppedFailures.length > 0
    ? `Dropped ${droppedFailures.length} of ${rawPages.length} pages from basic proxy.`
    : null;
  const jobStartIso = (job as { started_at?: string }).started_at;
  const durSec = jobStartIso
    ? Math.max(0, Math.floor((Date.now() - new Date(jobStartIso).getTime()) / 1000))
    : null;

  const { error: updErr } = await supabase
    .schema("web-hub")
    .from("crawl_jobs")
    .update({
      status:           "complete",
      pages_crawled:    contentItems.length,
      pages_found:      contentItems.length,
      completed_at:     new Date().toISOString(),
      crawl_results:    contentItems,
      duration_seconds: durSec,
      error_message:    errorMessage,
    })
    .eq("id", (job as { id: string }).id);
  if (updErr) {
    console.error("[firecrawl-webhook] crawl_job update failed:", updErr.message);
    return json({ error: "update_failed", details: updErr.message }, 500);
  }

  // Fire the post-crawl chain. copy-fixing is best-effort; atomize is
  // owned by the project so it dedupes across all completed jobs on
  // re-run. crawl-categorize is auto-fired by trg_chain_crawl_categorize
  // (Postgres trigger on status='complete'), so we don't call it here.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl && serviceKey) {
    try {
      await fetch(`${supabaseUrl}/functions/v1/copy-fixing`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body:    JSON.stringify({ project_id: projectId, crawl_job_id: (job as { id: string }).id }),
      }).catch(e => console.error("[firecrawl-webhook] copy-fixing kick failed:", e));
    } catch (e) { console.error("copy-fixing fire failed:", e); }
    try {
      const atomizeP = fetch(`${supabaseUrl}/functions/v1/atomize-crawl-into-atoms`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body:    JSON.stringify({ project_id: projectId }),
      }).catch(e => console.error("[firecrawl-webhook] atomize kick failed:", e));
      // deno-lint-ignore no-explicit-any
      const er = (globalThis as any).EdgeRuntime;
      if (er && typeof er.waitUntil === "function") er.waitUntil(atomizeP);
    } catch (e) { console.error("atomize fire failed:", e); }
  }

  return json({
    ok:                true,
    crawl_job_id:      (job as { id: string }).id,
    pages_stored:      contentItems.length,
    pages_dropped:     droppedFailures.length,
  }, 200);
});
