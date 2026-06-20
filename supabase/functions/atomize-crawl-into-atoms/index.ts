// atomize-crawl-into-atoms — Supabase Edge Function
//
// Decomposes a project's crawled-website data into content_atoms with
// source_kind='crawl', so the outline/draft pipeline can lift verbatim
// from the partner's existing copy when the partner is on the `high`
// verbatim band ("Keep most of our current content").
//
// Pre-Phase-1, atoms were only generated from curated sources
// (content_collection, strategy_brief, existing_snippet, etc.).
// The raw crawl markdown sat in web-hub.crawl_jobs.crawl_results
// and was never reachable by the pipeline. Verbatim ratio matched
// paraphrased atoms, not the partner's actual phrasing — band passed
// the math, failed the spirit.
//
// This function fixes that by atomizing one row per unique source page
// with body = full page markdown. Outline/draft consume these atoms
// keyed by `source_ref = <page url>`.
//
// Idempotent: deletes existing `source_kind='crawl'` atoms for the
// project before inserting fresh. Handles re-crawls (newest per-URL
// markdown wins via dedupe in the SELECT) and removed pages (stale
// URLs drop from the atom set).
//
// Body shape:
//   POST /functions/v1/atomize-crawl-into-atoms
//   { "project_id": "<uuid>" }
//
// Response: 200 with { project_id, pages_atomized, crawl_jobs_used }
//           404 if project_id has no completed crawls
//           400 if project_id is missing/invalid

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "supabase_env_missing" }, 500);
  }

  let projectId: string | null = null;
  try {
    const body = await req.json();
    projectId = typeof body.project_id === "string" ? body.project_id : null;
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }
  if (!projectId) return json({ error: "project_id_required" }, 400);

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1. Pull every completed crawl for this project. We union ALL
  //    completed jobs (not just the latest) — Ashley's #10: a unique
  //    page in crawl run 1 that didn't get re-fetched in run 2 should
  //    still atomize. Dedup by URL with newest job winning.
  const { data: jobs, error: jobErr } = await supabase
    .schema("web-hub")
    .from("crawl_jobs")
    .select("id, started_at, crawl_results")
    .eq("project_id", projectId)
    .eq("status", "complete")
    .not("crawl_results", "is", null)
    .order("started_at", { ascending: false });
  if (jobErr) {
    console.error("[atomize-crawl] crawl_jobs fetch failed:", jobErr.message);
    return json({ error: "crawl_jobs_fetch_failed", details: jobErr.message }, 500);
  }
  if (!jobs || jobs.length === 0) {
    return json({ error: "no_completed_crawls", project_id: projectId }, 404);
  }

  // 2. Build dedup'd page list. Iterate newest job first so the first
  //    write to the map wins (subsequent older jobs only contribute
  //    URLs the newer job didn't cover).
  //
  //    Dedup key is the URL normalized at the protocol-host-path
  //    level: lowercase host, single trailing slash stripped, no
  //    fragments. This collapses cosmetic dupes like
  //    /connect vs /connect/ that the crawler emits as two rows.
  type CrawlPage = { url?: string; markdown?: string; title?: string; content?: string };
  const normalizeUrl = (raw: string): string => {
    try {
      const u = new URL(raw);
      u.hash = "";
      u.hostname = u.hostname.toLowerCase();
      // Strip trailing slash except for root path ("/").
      if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.toString();
    } catch {
      return raw.trim();
    }
  };
  let pagesSkippedThin = 0;
  const byUrl = new Map<string, { jobId: string; page: CrawlPage; originalUrl: string }>();
  for (const job of jobs as Array<{ id: string; crawl_results: unknown }>) {
    const pages = Array.isArray(job.crawl_results) ? (job.crawl_results as CrawlPage[]) : [];
    for (const p of pages) {
      const url = (p?.url ?? "").trim();
      const md  = (p?.markdown ?? "").trim();
      if (!url) continue;
      if (md.length < 50) { pagesSkippedThin++; continue; }  // skip redirects, 404s
      const key = normalizeUrl(url);
      if (byUrl.has(key)) continue;             // newest-job-wins
      byUrl.set(key, { jobId: job.id, page: p, originalUrl: url });
    }
  }

  if (byUrl.size === 0) {
    return json({ error: "no_pages_with_markdown", project_id: projectId }, 404);
  }

  // 3. Wipe stale crawl atoms for this project so re-runs produce a
  //    clean set (removed pages drop out, slug renames stop leaving
  //    ghost rows). This is safe: source_kind='crawl' is owned
  //    entirely by this function — no other writer touches it.
  const { error: delErr } = await supabase
    .from("content_atoms")
    .delete()
    .eq("web_project_id", projectId)
    .eq("source_kind", "crawl");
  if (delErr) {
    console.error("[atomize-crawl] delete stale atoms failed:", delErr.message);
    return json({ error: "delete_stale_failed", details: delErr.message }, 500);
  }

  // 4. Insert fresh atoms — one per unique page. body holds the FULL
  //    page markdown (the rubric outline/draft will lift from).
  //    metadata carries the source crawl job id + page url + title +
  //    atom_role so consumers can filter by role downstream.
  const rows = [...byUrl.entries()].map(([normalizedUrl, { jobId, page, originalUrl }]) => ({
    web_project_id: projectId,
    topic:          (page.title ?? "").trim() || normalizedUrl.replace(/^https?:\/\/[^/]+\/?/, ""),
    body:           page.markdown ?? "",
    metadata: {
      crawl_job_id:    jobId,
      page_url:        normalizedUrl,
      page_url_source: originalUrl,
      page_title:      page.title ?? null,
      atom_role:       "page_rubric",
    },
    source_kind: "crawl",
    source_ref:  normalizedUrl,
    verbatim:    true,
    status:      "approved",
  }));

  const { error: insErr } = await supabase
    .from("content_atoms")
    .insert(rows);
  if (insErr) {
    console.error("[atomize-crawl] insert atoms failed:", insErr.message);
    return json({ error: "insert_atoms_failed", details: insErr.message }, 500);
  }

  return json({
    project_id:          projectId,
    pages_atomized:      rows.length,
    pages_skipped_thin:  pagesSkippedThin,
    crawl_jobs_used:     jobs.length,
  });
});
