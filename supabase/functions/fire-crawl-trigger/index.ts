// fire-crawl-trigger — kicks off a Firecrawl /v1/crawl, polls for
// completion, normalizes pages, runs the snippet extractor, writes
// results to web-hub.crawl_jobs.
//
// Repeat-prefix expansion: after the initial crawl completes, the
// trigger inspects the URL set. If 3+ pages share a 2-segment path
// prefix (e.g. `/leadership/jane`, `/leadership/john`, `/leadership/
// kate`) — a sign that detail-page enumeration ate the cap — and the
// crawl hit its page limit, the trigger fires a SECOND crawl with
// that prefix added to excludePaths and the cap bumped to 50. The
// second crawl's pages are merged with the first; the snippet
// extractor sees both. Caps out at one expansion per job to avoid
// runaway loops on sites with many such patterns.
//
// IMPORTANT field-mapping fix vs prior versions:
//   Firecrawl v1 returns each page as { url, markdown, html, links,
//   metadata: { title, ... } }. Older code wrote result.title and
//   result.content which Firecrawl doesn't populate — so titles came
//   out empty and markdown was lost entirely. This version reads from
//   the correct fields.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_EXCLUDE_PATHS = [
  "^/sermons?/[^/]+/?$", "^/messages?/[^/]+/?$", "^/posts?/[^/]+/?$",
  "^/blog/[^/]+/?$", "^/events?/[^/]+/?$", "^/stories/[^/]+/?$", "^/news/[^/]+/?$",
  "^/category/.*", "^/tag/.*", "^/author/.*", "/page/\\d+/?$",
  "^/wp-admin/.*", "^/wp-json/.*", "^/wp-content/.*", "/feed/?$",
  "\\.(?:pdf|xml|zip|jpe?g|png|gif|webp|svg|mp[34])(?:\\?.*)?$",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const payload = await req.json();
    const maxPages = payload.max_pages ?? 25;
    const maxDepth = payload.max_depth ?? 2;
    let excludePaths = Array.isArray(payload.exclude_paths) && payload.exclude_paths.length > 0
      ? payload.exclude_paths : DEFAULT_EXCLUDE_PATHS;

    if (!payload.project_id || !payload.target_url) {
      return json({ error: "Missing required fields" }, 400);
    }

    // v115 — multi-campus seed URLs. Read the project's campus
    // registry; if any campuses have a crawl_url, we'll run a separate
    // Firecrawl call per campus and merge the results into one
    // crawl_job. Without this, Firecrawl only sees the main target_url
    // and misses campuses whose subtrees aren't directly linked from
    // the homepage (Doxology's selector page links them via JS-routed
    // buttons that Firecrawl doesn't follow).
    //
    // Crawl budget = N seeds × maxPages. Three campuses + main URL
    // costs 4× the default. Staff can lower maxPages per call if
    // budget is a concern.
    const { data: projForSeeds } = await supabase
      .from("strategy_web_projects")
      .select("campuses")
      .eq("id", payload.project_id)
      .maybeSingle();
    const campusList = Array.isArray((projForSeeds as { campuses?: unknown } | null)?.campuses)
      ? ((projForSeeds as { campuses: Array<{ slug: string; crawl_url: string | null }> }).campuses)
      : [];
    const seedUrls: string[] = [];
    const seenSeeds = new Set<string>();
    const addSeed = (u: string | null | undefined) => {
      if (!u) return;
      const trimmed = u.trim();
      if (!trimmed) return;
      if (seenSeeds.has(trimmed)) return;
      seenSeeds.add(trimmed);
      seedUrls.push(trimmed);
    };
    addSeed(payload.target_url);
    for (const c of campusList) addSeed(c.crawl_url);
    const isMultiSeedCrawl = seedUrls.length > 1;

    // EXPAND mode — append new pages to an existing crawl job instead
    // of creating a new one. Caller passes expand_into_job_id; we read
    // its crawl_results, derive exclude rules from the URLs already
    // grabbed, and run a fresh crawl whose pages get appended to that
    // job. Use case: an initial crawl filled its page cap with post
    // detail pages (kids-resources/*, mbs-messages/*) and missed core
    // pages (staff, volunteers). Expansion mode lets the strategist
    // pick up the missing pages without losing the existing data.
    let existingJob = null;
    if (typeof payload.expand_into_job_id === "string") {
      const { data: ej, error: ejErr } = await supabase
        .schema("web-hub").from("crawl_jobs")
        .select("id, project_id, target_url, status, crawl_results, max_pages")
        .eq("id", payload.expand_into_job_id).maybeSingle();
      if (ejErr || !ej) return json({ error: "expand_into_job not found", details: ejErr?.message }, 404);
      if (ej.status !== "complete") {
        return json({ error: "expand_into_job is not complete — wait for the prior crawl first" }, 409);
      }
      existingJob = ej;
      // Build excludePaths from the existing crawl's URLs + heavy
      // prefixes. Every URL already grabbed becomes an exact-match
      // regex so Firecrawl skips it. Every path prefix that has ≥10
      // pages becomes a wildcard exclude so post-style enumerations
      // (e.g. /sermons/<slug>, /blog/<slug>) don't keep eating the
      // cap on a re-expand.
      //
      // Note: this prefix-exclude is EXPAND-MODE ONLY. The initial
      // crawl has no prior pages so this branch never runs there;
      // initial crawls are unaffected by this threshold.
      //
      // Threshold history:
      //   - Started at ≥2 (aggressive). Choked off legit detail-page
      //     expansion for thoroughly-crawled sites (Mountain Life:
      //     /staff with 6 bios, /missionary-bio with 5, /service-date
      //     with 5, /series with 12 — all flagged as enumerations and
      //     excluded, leaving the second expand with only 2 candidate
      //     URLs to try and 0 net additions).
      //   - Bumped to ≥10. A typical church site has 1-7 staff,
      //     1-8 missionaries, 1-10 ministries — none cross 10 in
      //     legitimate detail-page counts. Sermon archives + blog
      //     posts + event archives (the real enumerations) easily
      //     cross 10 and stay excluded. Re-expanding into a /staff
      //     prefix with 6 entries lets us find the 7th if they
      //     hired someone new since the initial crawl.
      const PREFIX_EXCLUDE_THRESHOLD = 10;
      const existingPages = Array.isArray(ej.crawl_results) ? ej.crawl_results : [];
      const exactPaths = new Set();
      const prefixCounts = new Map();
      for (const p of existingPages) {
        const u = p?.url || p?.metadata?.sourceURL || "";
        let path = "";
        try { path = new URL(u).pathname.replace(/\/$/, ""); } catch { continue; }
        if (path) exactPaths.add(path);
        const segs = path.split("/").filter(Boolean);
        if (segs.length >= 1) {
          const first = "/" + segs[0];
          prefixCounts.set(first, (prefixCounts.get(first) || 0) + 1);
        }
      }
      const exactExcludes = [...exactPaths].map(p => `^${escapeRegex(p)}/?$`);
      const prefixExcludes = [];
      for (const [prefix, count] of prefixCounts.entries()) {
        if (count >= PREFIX_EXCLUDE_THRESHOLD) prefixExcludes.push(`^${escapeRegex(prefix)}/[^/]+/?$`);
      }
      excludePaths = [...new Set([...excludePaths, ...exactExcludes, ...prefixExcludes])];
    }

    // Either reuse the existing crawl job (expand mode) or insert a new one.
    let crawlJob;
    if (existingJob) {
      // Bump max_pages on the existing job so the UI shows the
      // new ceiling. The new crawl's `limit` is whatever the
      // caller passed (default 25); the prior pages are preserved.
      const { data: updated, error: upErr } = await supabase
        .schema("web-hub").from("crawl_jobs")
        .update({
          status: "in_progress",
          max_pages: (existingJob.max_pages ?? 25) + maxPages,
          error_message: null,
        })
        .eq("id", existingJob.id).select().single();
      if (upErr) return json({ error: "Failed to mark expand job in_progress", details: upErr.message }, 500);
      crawlJob = updated;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .schema("web-hub").from("crawl_jobs")
        .insert({
          project_id: payload.project_id, target_url: payload.target_url,
          status: "in_progress", pages_crawled: 0,
          max_pages: maxPages, max_depth: maxDepth,
          started_at: new Date().toISOString(),
        }).select().single();
      if (insErr) return json({ error: "Failed to create crawl job", details: insErr.message }, 500);
      crawlJob = inserted;
    }

    const fireCrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!fireCrawlApiKey) {
      await supabase.schema("web-hub").from("crawl_jobs").update({ status: "failed", error_message: "API key missing" }).eq("id", crawlJob.id);
      return json({ error: "FIRECRAWL_API_KEY missing" }, 500);
    }

    // Wrapper for one Firecrawl crawl call (polled to completion).
    // Returns { pages, hitCap } where hitCap is true when Firecrawl
    // returned ≥ requested limit (detail-page enumeration likely
    // soaked it all up). Throws on permanent failure.
    // proxy: 'basic' (default; cheapest) | 'stealth' (~5x credits, but
    // bypasses most Squarespace / Cloudflare bot walls).
    const runFirecrawl = async (limit, excludePathsForRun, proxyMode = 'basic', overrideUrl: string | null = null) => {
      const seedUrl = overrideUrl ?? payload.target_url;
      const startRes = await fetch("https://api.firecrawl.dev/v1/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${fireCrawlApiKey}` },
        body: JSON.stringify({
          url: seedUrl, limit, maxDepth, excludePaths: excludePathsForRun,
          allowBackwardLinks: false, allowExternalLinks: false,
          // onlyMainContent:false includes footer + header chrome so
          // the LLM categorizer can pick up site-wide details (address,
          // phone, social links) that live in the footer on most
          // church sites. The downstream LLM filters nav noise.
          scrapeOptions: {
            formats: ["markdown", "html", "links"],
            onlyMainContent: false,
            proxy: proxyMode,
          },
        }),
      });
      if (!startRes.ok) {
        const t = await startRes.text();
        throw new Error(`Firecrawl start: ${t}`);
      }
      const startData = await startRes.json();

      const maxWaitMs = 300000;
      const pollMs = 5000;
      const t0 = Date.now();
      let done = false;
      let pages = [];
      while (!done && Date.now() - t0 < maxWaitMs) {
        await new Promise(r => setTimeout(r, pollMs));
        const statRes = await fetch(`https://api.firecrawl.dev/v1/crawl/${startData.id}`, {
          headers: { Authorization: `Bearer ${fireCrawlApiKey}` },
        });
        if (!statRes.ok) break;
        const stat = await statRes.json();
        await supabase.schema("web-hub").from("crawl_jobs")
          .update({ pages_crawled: stat.completed || 0, pages_found: stat.total || limit })
          .eq("id", crawlJob.id);
        if (stat.status === "completed") { done = true; pages = stat.data || []; }
        else if (stat.status === "failed") throw new Error("Firecrawl job failed");
      }
      if (!done) {
        return { pages, hitCap: false, timedOut: true };
      }
      return { pages, hitCap: pages.length >= limit, timedOut: false };
    };

    try {
      // v115 — for multi-campus projects, run one Firecrawl per seed
      // URL (main + each campus's crawl_url). All pages merge into the
      // same crawl_job's crawl_results. The first seed is the canonical
      // run that drives hitCap detection / repeat-prefix expansion;
      // additional seeds are append-only with no expansion pass.
      //
      // Dedup by URL across seeds — a campus selector landing page
      // that links Southwest, then we ALSO seed /southwest directly,
      // would otherwise double-count the Southwest pages.
      let pages: any[] = [];
      let initialTimedOut = false;
      let initialHitCap = false;
      const seenUrlsAcrossSeeds = new Set<string>();
      for (let seedIdx = 0; seedIdx < seedUrls.length; seedIdx++) {
        const seedUrl = seedUrls[seedIdx];
        const isMainSeed = seedIdx === 0;
        const seedRun = await runFirecrawl(maxPages, excludePaths, 'basic', seedUrl);
        if (isMainSeed) {
          initialTimedOut = seedRun.timedOut;
          initialHitCap = seedRun.hitCap;
        }
        if (seedRun.timedOut && isMainSeed) {
          await supabase.schema("web-hub").from("crawl_jobs").update({ status: "in_progress", error_message: "Polling timed out" }).eq("id", crawlJob.id);
          return json({ success: true, crawl_job_id: crawlJob.id, message: "in_progress" }, 202);
        }
        for (const p of seedRun.pages) {
          const u = p?.url || (p?.metadata && p.metadata.sourceURL) || "";
          if (!u || seenUrlsAcrossSeeds.has(u)) continue;
          seenUrlsAcrossSeeds.add(u);
          pages.push(p);
        }
        if (isMultiSeedCrawl) {
          console.log(`[fire-crawl-trigger] seed ${seedIdx + 1}/${seedUrls.length} (${seedUrl}): +${seedRun.pages.length} pages, total ${pages.length}`);
        }
      }
      const initial = { pages, hitCap: initialHitCap, timedOut: initialTimedOut };

      // Repeat-prefix detection. Bucket URLs by their first two path
      // segments. If any prefix has ≥3 URLs (likely detail-page
      // enumeration: /leadership/jane, /leadership/john, …) AND the
      // crawl filled its cap, do ONE expansion pass — exclude those
      // prefixes and crawl again at the EXPANDED cap so the
      // categorizer sees the next layer of pages instead.
      if (initial.hitCap) {
        const prefixCounts = new Map();
        for (const p of pages) {
          const u = p.url || (p.metadata && p.metadata.sourceURL) || "";
          let pathOnly = "";
          try { pathOnly = new URL(u).pathname; } catch { continue; }
          const segs = pathOnly.split("/").filter(Boolean);
          if (segs.length < 2) continue;
          const prefix = "/" + segs[0];
          prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
        }
        const heavyPrefixes = [];
        for (const [prefix, count] of prefixCounts.entries()) {
          // Skip prefixes that are already excluded by default.
          const alreadyExcluded = excludePaths.some(rule =>
            rule.includes(prefix.replace(/^\//, "")) || rule.includes(prefix),
          );
          if (alreadyExcluded) continue;
          if (count >= 3) heavyPrefixes.push({ prefix, count });
        }
        if (heavyPrefixes.length > 0) {
          console.log("Repeat-prefix expansion:", heavyPrefixes);
          const expandedExcludes = [
            ...excludePaths,
            ...heavyPrefixes.map(p => `^${p.prefix}/[^/]+/?$`),
          ];
          const expandedLimit = 50;
          try {
            const expanded = await runFirecrawl(expandedLimit, expandedExcludes);
            if (!expanded.timedOut && expanded.pages.length > 0) {
              // Merge by URL — keep first occurrence (initial wins on
              // duplicates). The expanded pass should mostly add new
              // URLs since heavy prefixes are now excluded.
              const seen = new Set(pages.map(p => p.url || (p.metadata && p.metadata.sourceURL) || ""));
              for (const p of expanded.pages) {
                const u = p.url || (p.metadata && p.metadata.sourceURL) || "";
                if (u && !seen.has(u)) { pages.push(p); seen.add(u); }
              }
            }
          } catch (e) {
            console.error("Expansion crawl failed:", e?.message ?? e);
            // Soft-fail — initial pages still ship.
          }
        }
      }

      // Drop pages that Firecrawl failed to scrape. Firecrawl returns
      // failed pages with metadata.statusCode >= 400 + metadata.error
      // set + markdown body containing the error string ("Invalid
      // upstream proxy credentials", "Internal server error", etc.).
      // Without this filter the error strings get stored as page
      // content and poison everything downstream — categorizer reads
      // them, web_project_topics inherits them, the partner-facing
      // Content Collection page displays them. Real example seen on
      // baysidechurch.net (2026-06-06 crawl): 44 of 66 pages came
      // back with statusCode 597 + markdown="Invalid upstream proxy
      // credentials".
      const isScrapeFailure = (r) => {
        const meta = r && r.metadata;
        if (!meta) return false;
        const status = Number(meta.statusCode);
        if (Number.isFinite(status) && status >= 400) return true;
        if (meta.error) return true;
        return false;
      };
      const droppedFailures = [];
      const okPages = [];
      for (const r of pages) {
        if (isScrapeFailure(r)) {
          droppedFailures.push({
            url: r.url || (r.metadata && r.metadata.sourceURL) || "",
            statusCode: r.metadata && r.metadata.statusCode,
            error: r.metadata && r.metadata.error,
            proxyUsed: r.metadata && r.metadata.proxyUsed,
          });
        } else {
          okPages.push(r);
        }
      }
      if (droppedFailures.length > 0) {
        console.warn(`[fire-crawl-trigger] dropped ${droppedFailures.length} scrape failures (basic proxy):`, droppedFailures.slice(0, 10));
      }

      // ── Stealth proxy fallback ────────────────────────────────────
      // When the basic proxy fails on a meaningful fraction of pages
      // (Squarespace, Cloudflare bot walls, anti-scrape on dynamic
      // pages), retry each failed URL with proxy='stealth' through
      // Firecrawl's /v1/scrape per-URL endpoint. Stealth uses
      // residential IPs + browser fingerprinting and gets through
      // most basic-bot defenses. Costs ~5x credits per page, so we
      // only run it for the failed subset and only when the failure
      // rate clears a threshold (don't burn credits when 1 page out
      // of 50 fails).
      const totalAttempted = pages.length;
      const failureRate = totalAttempted > 0 ? droppedFailures.length / totalAttempted : 0;
      const STEALTH_TRIGGER_RATE = 0.20;            // ≥20% basic failures triggers stealth
      const STEALTH_TRIGGER_FLOOR = 5;              // OR ≥5 absolute failures
      const STEALTH_MAX_RETRIES   = 50;             // safety cap on credits
      const stealthRecoveries = [];
      const stillFailedAfterStealth = [];
      if (
        droppedFailures.length > 0 &&
        (failureRate >= STEALTH_TRIGGER_RATE || droppedFailures.length >= STEALTH_TRIGGER_FLOOR)
      ) {
        const urlsToRetry = droppedFailures.slice(0, STEALTH_MAX_RETRIES).map(f => f.url).filter(Boolean);
        console.log(`[fire-crawl-trigger] stealth retry: ${urlsToRetry.length} URLs (failure rate ${(failureRate * 100).toFixed(0)}%)`);
        for (const url of urlsToRetry) {
          try {
            const sRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${fireCrawlApiKey}` },
              body: JSON.stringify({
                url,
                formats: ["markdown", "html", "links"],
                onlyMainContent: false,
                proxy: "stealth",
              }),
            });
            if (!sRes.ok) {
              stillFailedAfterStealth.push({ url, http: sRes.status });
              continue;
            }
            const body = await sRes.json();
            const page = body?.data ?? body;
            if (isScrapeFailure(page)) {
              stillFailedAfterStealth.push({
                url,
                statusCode: page?.metadata?.statusCode,
                error: page?.metadata?.error,
              });
              continue;
            }
            // Stealth recovered the page — merge into okPages.
            okPages.push(page);
            stealthRecoveries.push(url);
          } catch (e) {
            stillFailedAfterStealth.push({ url, threw: String(e?.message ?? e) });
          }
        }
        console.log(`[fire-crawl-trigger] stealth recovered ${stealthRecoveries.length}/${urlsToRetry.length}; still failed ${stillFailedAfterStealth.length}`);
      }

      // Map Firecrawl's actual response to our canonical storage shape.
      // Firecrawl puts title under metadata; markdown at the root;
      // links as a top-level array.
      const contentItems = okPages.map((r) => ({
        url:       r.url || (r.metadata && r.metadata.sourceURL) || "",
        title:     (r.metadata && r.metadata.title) || "",
        markdown:  r.markdown || "",
        content:   r.markdown || "",
        html:      r.html || r.rawHtml || "",
        links:     Array.isArray(r.links) ? r.links : [],
        metadata:  r.metadata || {},
      }));

      try {
        const snippets = extractSnippets(contentItems, payload.target_url);
        if (snippets.length > 0) await upsertSnippets(supabase, payload.project_id, snippets);
      } catch (e) { console.error("snippet failed:", e); }

      const jobStart = new Date(crawlJob.started_at || crawlJob.created_at);
      const durSec = Math.floor((Date.now() - jobStart.getTime()) / 1000);
      const errorMessage = (droppedFailures.length === 0 && stealthRecoveries.length === 0 && stillFailedAfterStealth.length === 0)
        ? null
        : [
            droppedFailures.length > 0 && `Basic proxy failed on ${droppedFailures.length} of ${pages.length} pages.`,
            stealthRecoveries.length > 0 && `Stealth proxy recovered ${stealthRecoveries.length}.`,
            stillFailedAfterStealth.length > 0 && `${stillFailedAfterStealth.length} pages still unreachable after stealth retry.`,
            stillFailedAfterStealth.length > 0 && `Affected URLs (first 3): ${stillFailedAfterStealth.slice(0, 3).map(f => f.url).join(', ')}`,
          ].filter(Boolean).join(' ');
      // Expand mode merges new pages with the existing crawl_results
      // (dedupe by URL — Firecrawl shouldn't return excluded URLs,
      // but belt-and-suspenders). Fresh-crawl mode just writes the
      // new array directly.
      let mergedItems = contentItems;
      if (existingJob) {
        const priorPages = Array.isArray(existingJob.crawl_results) ? existingJob.crawl_results : [];
        const seenUrls = new Set(priorPages.map(p => p?.url || p?.metadata?.sourceURL).filter(Boolean));
        const additions = contentItems.filter(p => {
          const u = p?.url || p?.metadata?.sourceURL;
          return u && !seenUrls.has(u);
        });
        mergedItems = [...priorPages, ...additions];
      }
      await supabase.schema("web-hub").from("crawl_jobs").update({
        status: "complete", pages_crawled: mergedItems.length,
        completed_at: new Date().toISOString(), crawl_results: mergedItems, duration_seconds: durSec,
        error_message: errorMessage,
      }).eq("id", crawlJob.id);

      try {
        await fetch(`${supabaseUrl}/functions/v1/copy-fixing`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
          body: JSON.stringify({ project_id: payload.project_id, crawl_job_id: crawlJob.id }),
        });
      } catch (e) { console.error("copy-fixing failed:", e); }

      // Atomize the crawl into content_atoms with source_kind='crawl'
      // so the outline/draft pipeline can lift verbatim from the
      // partner's existing copy when they're on the `high` band.
      //
      // EdgeRuntime.waitUntil keeps the in-flight fetch alive after
      // we return our response — without it, Deno's runtime may kill
      // the request once the handler exits. Atomize isn't on the
      // response critical path; the function is idempotent so a
      // transient failure can be retried via the backfill script.
      try {
        const atomizePromise = fetch(`${supabaseUrl}/functions/v1/atomize-crawl-into-atoms`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
          body: JSON.stringify({ project_id: payload.project_id }),
        }).catch((e) => console.error("atomize-crawl-into-atoms fire failed:", e));
        // deno-lint-ignore no-explicit-any
        const er = (globalThis as any).EdgeRuntime;
        if (er && typeof er.waitUntil === "function") {
          er.waitUntil(atomizePromise);
        }
      } catch (e) { console.error("atomize-crawl-into-atoms invoke failed:", e); }

      return json({ success: true, crawl_job_id: crawlJob.id, pages_crawled: contentItems.length }, 200);
    } catch (err) {
      await supabase.schema("web-hub").from("crawl_jobs").update({ status: "failed", error_message: err.message }).eq("id", crawlJob.id);
      return json({ error: "Crawl failed", details: err.message }, 500);
    }
  } catch (err) {
    return json({ error: "Internal", details: err.message }, 500);
  }
});

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Escape regex metacharacters in a string so it can be used as a
// literal-match prefix inside Firecrawl's excludePaths (regex strings).
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Crawl-time snippet extraction. Limited to high-confidence URL-pattern
// candidates and explicit links — phone/email/address/pastor extraction
// is intentionally left to the LLM categorizer (crawl-categorize),
// where it gets context and avoids matching unrelated digit sequences.
// Social URLs are pattern-based and reliable enough to extract here.
function extractSnippets(pages, originUrl) {
  const all = pages.map(p => `${p.markdown || ""}\n${p.html || ""}`).join("\n");
  const out = [];
  const push = (token, label, value, tag) => {
    if (!value || value.length < 2) return;
    if (out.some(r => r.token === token)) return;
    out.push({ token, label, expansion: value, description: "Auto-extracted from website crawl.", tags: [tag, "auto"] });
  };
  const fu = (re) => { const m = all.match(re); return m ? m[0].replace(/[).,;]+$/, "") : null; };

  const fb = fu(/https?:\/\/(?:www\.)?facebook\.com\/[\w\-./]+/i); if (fb) push("facebook_url", "Facebook URL", fb, "social");
  const ig = fu(/https?:\/\/(?:www\.)?instagram\.com\/[\w\-./]+/i); if (ig) push("instagram_url", "Instagram URL", ig, "social");
  const yt = fu(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w\-.]+|channel\/[\w\-]+|c\/[\w\-]+)/i); if (yt) push("youtube_url", "YouTube URL", yt, "social");
  const tt = fu(/https?:\/\/(?:www\.)?tiktok\.com\/@[\w\-.]+/i); if (tt) push("tiktok_url", "TikTok URL", tt, "social");
  const give = fu(/https?:\/\/[\w\-./]*(?:give|giving|donate)[\w\-./?=&%#]*/i); if (give) push("give_url", "Giving URL", give, "actions");
  const dir = fu(/https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)\/[\w\-./?=&%#@,+]+/i); if (dir) push("directions_url", "Directions URL", dir, "location");
  const live = fu(/https?:\/\/[\w\-./]*(?:livestream|watch\-live|live\-stream|\/live\b)[\w\-./?=&%#]*/i); if (live) push("livestream_url", "Livestream URL", live, "actions");
  push("site_url", "Public site URL", originUrl, "site");
  return out;
}

// Token → strategy_web_projects column. See crawl-categorize for the
// authoritative version; this mirrors a subset for the snippets that
// fire-crawl-trigger itself can produce (social URLs).
const GLOBAL_TOKEN_MAP = {
  facebook_url:  "social_facebook_url",
  instagram_url: "social_instagram_url",
  youtube_url:   "social_youtube_url",
  tiktok_url:    "social_tiktok_url",
};

// Routes crawl-extracted snippets: globals → strategy_web_projects
// (fill-if-empty); customs → web_project_snippets (skip if token exists).
async function upsertSnippets(supabase, projectId, snippets) {
  const seen = new Set();
  const globalFills = {};
  const customQueue = [];
  for (const s of snippets) {
    if (!s?.token || !s?.expansion) continue;
    if (seen.has(s.token)) continue;
    seen.add(s.token);
    const col = GLOBAL_TOKEN_MAP[s.token];
    if (col) {
      if (!(col in globalFills)) globalFills[col] = s.expansion;
    } else {
      customQueue.push(s);
    }
  }

  if (Object.keys(globalFills).length > 0) {
    const cols = Object.keys(globalFills);
    const { data: project } = await supabase
      .from("strategy_web_projects")
      .select(`id,${cols.join(",")}`)
      .eq("id", projectId)
      .maybeSingle();
    if (project) {
      const updates = {};
      for (const col of cols) {
        const cur = project[col];
        if (cur === null || cur === undefined || (typeof cur === "string" && cur.trim() === "")) {
          updates[col] = globalFills[col];
        }
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from("strategy_web_projects").update(updates).eq("id", projectId);
      }
    }
  }

  if (customQueue.length === 0) return;
  const tokens = customQueue.map(s => s.token);
  const { data: existing } = await supabase.from("web_project_snippets").select("token").eq("web_project_id", projectId).eq("archived", false).in("token", tokens);
  const existingTokens = new Set((existing || []).map(r => r.token));
  const rows = customQueue.filter(s => !existingTokens.has(s.token)).map(s => ({
    web_project_id: projectId, token: s.token, label: s.label, expansion: s.expansion,
    description: s.description, tags: s.tags, source: "crawl_prefill", archived: false, used_count: 0,
  }));
  if (rows.length === 0) return;
  await supabase.from("web_project_snippets").insert(rows);
}
