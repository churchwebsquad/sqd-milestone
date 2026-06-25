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

  // ── crawl.completed: fetch the actual page data from Firecrawl ──
  // Firecrawl's webhook payload signals completion but doesn't include
  // the page array — you have to GET /v1/crawl/{id} to retrieve the
  // actual data. (The earlier implementation read body.data and got
  // empty arrays, leaving every crawl_job with 0 pages despite
  // Firecrawl successfully crawling dozens.)
  //
  // Large crawls bloat with detail-page enumerations (/events/<slug>,
  // /sermons/<title>, /blog/<post>). For Doxology espanol Firecrawl
  // returned 255 pages — most were per-event detail pages with no
  // navigable value. We process page-by-page (paginated via Firecrawl's
  // `next` cursor) and filter via two passes:
  //   1. Strip html immediately (Webflow HTML is 30-80 KB/page).
  //   2. Drop URLs under any path prefix that hits PREFIX_KEEP_THRESHOLD.
  //      Keep the index (e.g. /events) and drop the children
  //      (/events/baptism, /events/community-groups, ...).
  // Net: 255 raw pages → ~30 actually-useful pages.
  const PREFIX_KEEP_THRESHOLD = 3; // ≥3 children → drop them, keep only the index
  let rawPages: CrawlPage[] = [];
  const fireKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!fireKey) {
    console.error("[firecrawl-webhook] FIRECRAWL_API_KEY missing — can't fetch crawl data");
  } else {
    try {
      // First pass: paginate /v1/crawl/{id}, strip html, collect URLs +
      // metadata-light pages. We tally first-segment prefix counts as
      // we go so we can filter the heavy enumerations out after.
      const prefixCounts = new Map<string, number>();
      const stripHtml = (p: CrawlPage): CrawlPage => ({ ...p, html: undefined, rawHtml: undefined } as CrawlPage);
      const firstSegment = (u: string | undefined): string | null => {
        if (!u) return null;
        try {
          const path = new URL(u).pathname;
          const seg = path.split('/').filter(Boolean)[0];
          return seg ? `/${seg}` : null;
        } catch { return null; }
      };
      const ingest = (pages: CrawlPage[]) => {
        for (const raw of pages) {
          const stripped = stripHtml(raw);
          rawPages.push(stripped);
          const u = stripped.url ?? stripped.metadata?.sourceURL ?? '';
          const prefix = firstSegment(u);
          if (prefix) prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
        }
      };
      // Paginate via ?limit=N&skip=N. Each page batch is processed
      // and stripped to essentials (url, title, markdown only) before
      // appending to rawPages — full Firecrawl objects carry html,
      // content (dup of markdown), links, metadata which sum to too
      // much memory for 255-page crawls. We only keep what downstream
      // consumers (atomize, categorize) actually read.
      //
      // Also: hard cap MAX_KEEP. Once we have 75 useful pages, stop
      // fetching. Church sites with way more than that are usually
      // padded with event/sermon detail enumerations; the heavy-prefix
      // filter below catches those after the fact, but we don't even
      // need to fetch them.
      const PAGE_SIZE = 20;
      const MAX_KEEP = 100;
      const slim = (p: CrawlPage): CrawlPage => ({
        url:      p.url ?? p.metadata?.sourceURL ?? '',
        title:    p.metadata?.title ?? p.title ?? '',
        markdown: p.markdown ?? '',
        metadata: {
          sourceURL:  p.metadata?.sourceURL ?? '',
          statusCode: p.metadata?.statusCode,
          error:      p.metadata?.error,
          title:      p.metadata?.title ?? '',
        },
      });
      let skip = 0;
      let total: number | null = null;
      const MAX_ITER = 30;
      for (let i = 0; i < MAX_ITER; i++) {
        const u = `https://api.firecrawl.dev/v1/crawl/${firecrawlCrawlId}?limit=${PAGE_SIZE}&skip=${skip}`;
        const r = await fetch(u, { headers: { Authorization: `Bearer ${fireKey}` } });
        if (!r.ok) {
          console.error(`[firecrawl-webhook] /v1/crawl page fetch failed at skip=${skip}: ${r.status}`);
          break;
        }
        const b = await r.json() as { data?: CrawlPage[]; status?: string; total?: number };
        if (typeof b.total === 'number') total = b.total;
        const batch = Array.isArray(b.data) ? b.data : [];
        if (batch.length === 0) break;
        ingest(batch.map(slim));
        skip += batch.length;
        if (total !== null && skip >= total) break;
        if (rawPages.length >= MAX_KEEP) break;
      }
      console.log(`[firecrawl-webhook] fetched ${rawPages.length} pages from Firecrawl (reported total ${total ?? 'unknown'})`);

      // Heavy-prefix filter: when a first-path-segment has N+ pages,
      // it's a detail-page enumeration. Keep only the index (/events)
      // and drop the children (/events/<slug>). For per-page sites
      // with ≤2 children the threshold doesn't fire, so /staff/jane
      // and /staff/john survive on small sites.
      const heavyPrefixes = new Set<string>();
      for (const [prefix, count] of prefixCounts.entries()) {
        if (count >= PREFIX_KEEP_THRESHOLD) heavyPrefixes.add(prefix);
      }
      if (heavyPrefixes.size > 0) {
        const before = rawPages.length;
        rawPages = rawPages.filter(p => {
          const u = p.url ?? p.metadata?.sourceURL ?? '';
          if (!u) return false;
          let path: string;
          try { path = new URL(u).pathname; } catch { return false; }
          // Keep the prefix root itself (/events, /events/) — drop only deeper paths.
          for (const prefix of heavyPrefixes) {
            if (path.startsWith(prefix + '/')) {
              // Allowed: the index itself (path === prefix + '/').
              const tail = path.slice(prefix.length + 1).replace(/\/$/, '');
              if (tail.length > 0) return false;
            }
          }
          return true;
        });
        console.log(`[firecrawl-webhook] heavy-prefix filter: ${before} → ${rawPages.length} (dropped under ${[...heavyPrefixes].join(', ')})`);
      }
    } catch (e) {
      console.error("[firecrawl-webhook] data fetch threw:", e instanceof Error ? e.message : e);
    }
  }
  // Fallback to body.data in case Firecrawl ever includes it inline.
  if (rawPages.length === 0 && Array.isArray(body.data)) rawPages = body.data;
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

  // Strip the `html` field — Webflow / heavy-CSS sites produce 30-80KB
  // of HTML per page that downstream consumers (atomize, categorize)
  // never read. For 255-page crawls, keeping HTML pushed the edge
  // function past its memory limit. Drop it; keep markdown as the
  // canonical body.
  const contentItems = okPages
    .map(normalizePage)
    .filter(p => p.url)
    .map(p => ({ ...p, html: '' }));
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
