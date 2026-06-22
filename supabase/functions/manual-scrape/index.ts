// manual-scrape — strategist-driven scrape of one or more specific URLs.
// Replaces the older scrape-test function with three capabilities:
//
//   1. URL LIST: takes urls[] instead of a single URL so the
//      strategist can paste a focused list of pages the full crawl
//      missed (e.g. /milestone-1, /milestone-2, ...) without re-firing
//      the whole crawl.
//
//   2. CRAWL DEEPER: optional crawl_deeper.max_depth lets the run
//      follow internal links from each seed URL N levels deep —
//      useful when a parent page lists detail-page children the
//      seed crawl excluded.
//
//   3. COMMIT MODE: by default the function is preview-only (no DB
//      writes). When commit.project_id is provided, results are
//      appended to the latest web-hub.crawl_jobs row for that project
//      AND a fresh categorize is triggered so the new pages flow into
//      web_project_topics. The strategist can re-fire crawl-categorize
//      from the dashboard if they want fresher routing logic.
//
// Request body:
//   {
//     urls: string[],                              // 1-25 URLs
//     crawl_deeper?: { max_depth?: 1|2, max_pages?: number },
//     commit?: { project_id: string },             // omit for preview
//   }
//
// Response body:
//   { ok: true, duration, pages: PagePayload[], committed?: { rows: number, crawl_job_id: string } }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ManualScrapeRequest {
  urls: string[];
  crawl_deeper?: { max_depth?: number; max_pages?: number };
  commit?: { project_id: string };
  /** JS render + click sequences. When set, Firecrawl waits for the
   *  page to render, then performs a sequence of click+wait actions
   *  before capturing the final DOM. Use for sites where bio popups,
   *  accordion expanders, or tab content are lazy-loaded via JS
   *  (Arvada Vineyard's Essential Addons popups are the canonical
   *  case — bios stay hidden until the "Learn More" buttons are
   *  clicked). Actions run sequentially on a SINGLE page load, so
   *  capturing N popups means N click+wait pairs. */
  deep?: {
    /** CSS selectors to click in order. Each click is followed by a
     *  short wait. Pass selectors targeting EVERY trigger that needs
     *  to fire to populate the lazy content (e.g. ".eae-pop-btn a"
     *  for Essential Addons, "[data-toggle='modal']" for Bootstrap). */
    click_selectors?: string[];
    /** Wait between clicks (ms). Defaults to 1500. */
    wait_ms?: number;
    /** Initial wait after page load before clicking, ms. Defaults to 2000. */
    initial_wait_ms?: number;
  };
}

interface PagePayload {
  url:      string;
  title?:   string;
  content?: string;     // markdown
  html?:    string;
  links?:   string[];
  metadata?: Record<string, unknown>;
  source_url?: string;  // the seed URL that produced this page (for crawl-deeper rows)
}

const MAX_URLS = 25;
const SCRAPE_TIMEOUT_MS = 60_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  try {
    const body: ManualScrapeRequest = await req.json();
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return jsonResponse(500, { error: "FIRECRAWL_API_KEY not configured" });
    }
    const urls = Array.isArray(body.urls) ? body.urls.map(s => String(s).trim()).filter(Boolean) : [];
    if (urls.length === 0) {
      return jsonResponse(400, { error: "urls is required (non-empty array of strings)" });
    }
    if (urls.length > MAX_URLS) {
      return jsonResponse(400, { error: `Too many URLs: ${urls.length}. Max ${MAX_URLS} per call.` });
    }
    const maxDepth = body.crawl_deeper?.max_depth ?? 0;   // 0 = scrape only
    const maxPages = body.crawl_deeper?.max_pages ?? 10;

    const t0 = Date.now();
    const all: PagePayload[] = [];

    for (const seed of urls) {
      if (maxDepth >= 1) {
        // Crawl-deeper path: Firecrawl /v1/crawl with bounded depth +
        // page cap. Polled to completion. Pages are stamped with the
        // seed URL so the UI can group them.
        const pages = await runCrawl(seed, maxDepth, maxPages, apiKey);
        for (const p of pages) all.push({ ...p, source_url: seed });
      } else {
        // Plain scrape OR deep (JS render + click sequence).
        const page = await runScrape(seed, apiKey, body.deep);
        if (page) all.push(page);
      }
    }
    const duration = Date.now() - t0;

    // Commit path: append to latest crawl_jobs row for the project.
    let committed: { rows: number; crawl_job_id: string } | undefined;
    if (body.commit?.project_id) {
      committed = await commitToCrawlJobs(body.commit.project_id, all);
    }

    return jsonResponse(200, { ok: true, duration, pages: all, committed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { error: "Unexpected", details: msg });
  }
});

async function runScrape(
  url: string,
  apiKey: string,
  deep?: { click_selectors?: string[]; wait_ms?: number; initial_wait_ms?: number },
): Promise<PagePayload | null> {
  // Deep scrapes can take 30-60s because each click triggers AJAX +
  // wait. Bump the timeout when deep mode is active.
  const timeoutMs = deep?.click_selectors?.length ? 120_000 : SCRAPE_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = {
      url,
      formats: ["markdown", "html", "links"],
      onlyMainContent: false,
    };
    if (deep?.click_selectors && deep.click_selectors.length > 0) {
      const initialWait = deep.initial_wait_ms ?? 2000;
      const perClickWait = deep.wait_ms ?? 1500;
      const actions: Array<Record<string, unknown>> = [
        { type: "wait", milliseconds: initialWait },
      ];
      for (const sel of deep.click_selectors) {
        actions.push({ type: "click", selector: sel });
        actions.push({ type: "wait", milliseconds: perClickWait });
      }
      body.actions = actions;
    }
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text();
      return { url, title: "", content: `[scrape error ${res.status}: ${errText.slice(0, 200)}]` };
    }
    const data = await res.json();
    const payload = data.data ?? data;
    return {
      url,
      title:    payload?.metadata?.title ?? payload?.title ?? "",
      content:  payload?.markdown ?? payload?.content ?? "",
      html:     payload?.html,
      links:    Array.isArray(payload?.links) ? payload.links.filter((l: unknown): l is string => typeof l === "string") : undefined,
      metadata: payload?.metadata,
    };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return { url, title: "", content: `[scrape exception: ${msg}]` };
  }
}

async function runCrawl(seed: string, maxDepth: number, maxPages: number, apiKey: string): Promise<PagePayload[]> {
  // Start job
  const startRes = await fetch("https://api.firecrawl.dev/v1/crawl", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      url: seed,
      limit: maxPages,
      maxDepth,
      allowBackwardLinks: false,
      allowExternalLinks: false,
      scrapeOptions: {
        formats: ["markdown", "html", "links"],
        onlyMainContent: false,
      },
    }),
  });
  if (!startRes.ok) {
    const errText = await startRes.text();
    return [{ url: seed, title: "", content: `[crawl start error ${startRes.status}: ${errText.slice(0, 200)}]` }];
  }
  const { id: jobId } = await startRes.json();
  if (!jobId) return [{ url: seed, title: "", content: "[crawl start returned no job id]" }];

  // Poll to completion (bounded budget — strategist may have many seeds)
  const maxWaitMs = 90_000;
  const pollMs = 4000;
  const t0 = Date.now();
  while (Date.now() - t0 < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollMs));
    const statRes = await fetch(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!statRes.ok) continue;
    const stat = await statRes.json();
    if (stat.status === "completed") {
      const pages = Array.isArray(stat.data) ? stat.data : [];
      return pages.map((p: Record<string, unknown>) => ({
        url:      typeof p.url === "string" ? p.url : seed,
        title:    typeof (p.metadata as Record<string, unknown>)?.title === "string"
          ? ((p.metadata as Record<string, unknown>).title as string)
          : "",
        content:  typeof p.markdown === "string" ? p.markdown : (typeof p.content === "string" ? p.content : ""),
        html:     typeof p.html === "string" ? p.html : undefined,
        links:    Array.isArray(p.links) ? (p.links as unknown[]).filter((l): l is string => typeof l === "string") : undefined,
        metadata: typeof p.metadata === "object" && p.metadata !== null ? p.metadata as Record<string, unknown> : undefined,
      }));
    }
    if (stat.status === "failed") {
      return [{ url: seed, title: "", content: "[crawl job failed]" }];
    }
  }
  return [{ url: seed, title: "", content: "[crawl polling timed out]" }];
}

async function commitToCrawlJobs(projectId: string, pages: PagePayload[]): Promise<{ rows: number; crawl_job_id: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase env not configured for commit");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Find the latest crawl_jobs row for the project. If one exists,
  // append; otherwise create a fresh row tagged source='manual_scrape'.
  const { data: existing, error: selErr } = await supabase
    .schema("web-hub")
    .from("crawl_jobs")
    .select("id, crawl_results, pages_crawled")
    .eq("project_id", projectId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (selErr) throw new Error(`crawl_jobs select failed: ${selErr.message}`);

  const newResults = pages.map(p => ({
    url:     p.url,
    title:   p.title ?? "",
    content: p.content ?? "",
  }));

  if (existing) {
    const merged = Array.isArray(existing.crawl_results) ? existing.crawl_results : [];
    // De-dupe by URL — manual scrape often re-scrapes pages already in the crawl.
    const byUrl = new Map<string, { url: string; title: string; content: string }>();
    for (const r of merged) byUrl.set(String((r as { url: string }).url), r as { url: string; title: string; content: string });
    for (const r of newResults) byUrl.set(r.url, r);
    const finalResults = Array.from(byUrl.values());
    const { error: updErr } = await supabase
      .schema("web-hub")
      .from("crawl_jobs")
      .update({
        crawl_results: finalResults,
        pages_crawled: finalResults.length,
        completed_at:  new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updErr) throw new Error(`crawl_jobs update failed: ${updErr.message}`);
    return { rows: newResults.length, crawl_job_id: existing.id as string };
  }
  const insertRes = await supabase
    .schema("web-hub")
    .from("crawl_jobs")
    .insert({
      project_id:    projectId,
      target_url:    pages[0]?.url ?? "",
      status:        "complete",
      pages_crawled: newResults.length,
      pages_found:   newResults.length,
      started_at:    new Date().toISOString(),
      completed_at:  new Date().toISOString(),
      crawl_results: newResults,
    })
    .select("id")
    .single();
  if (insertRes.error) throw new Error(`crawl_jobs insert failed: ${insertRes.error.message}`);
  return { rows: newResults.length, crawl_job_id: insertRes.data.id as string };
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
