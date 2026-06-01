// fire-crawl-trigger — kicks off a Firecrawl /v1/crawl, polls for
// completion, normalizes pages, runs the snippet extractor, writes
// results to web-hub.crawl_jobs.
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
    const excludePaths = Array.isArray(payload.exclude_paths) && payload.exclude_paths.length > 0
      ? payload.exclude_paths : DEFAULT_EXCLUDE_PATHS;

    if (!payload.project_id || !payload.target_url) {
      return json({ error: "Missing required fields" }, 400);
    }

    const { data: crawlJob, error: crawlJobError } = await supabase
      .schema("web-hub").from("crawl_jobs")
      .insert({
        project_id: payload.project_id, target_url: payload.target_url,
        status: "in_progress", pages_crawled: 0,
        max_pages: maxPages, max_depth: maxDepth,
        started_at: new Date().toISOString(),
      }).select().single();
    if (crawlJobError) return json({ error: "Failed to create crawl job", details: crawlJobError.message }, 500);

    const fireCrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!fireCrawlApiKey) {
      await supabase.schema("web-hub").from("crawl_jobs").update({ status: "failed", error_message: "API key missing" }).eq("id", crawlJob.id);
      return json({ error: "FIRECRAWL_API_KEY missing" }, 500);
    }

    try {
      const startRes = await fetch("https://api.firecrawl.dev/v1/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${fireCrawlApiKey}` },
        body: JSON.stringify({
          url: payload.target_url, limit: maxPages, maxDepth, excludePaths,
          allowBackwardLinks: false, allowExternalLinks: false,
          scrapeOptions: { formats: ["markdown", "html", "links"], onlyMainContent: true },
        }),
      });
      if (!startRes.ok) {
        const t = await startRes.text();
        await supabase.schema("web-hub").from("crawl_jobs").update({ status: "failed", error_message: `API: ${t}` }).eq("id", crawlJob.id);
        return json({ error: "Firecrawl error", details: t }, 500);
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
          .update({ pages_crawled: stat.completed || 0, pages_found: stat.total || maxPages })
          .eq("id", crawlJob.id);
        if (stat.status === "completed") { done = true; pages = stat.data || []; }
        else if (stat.status === "failed") throw new Error("Firecrawl job failed");
      }
      if (!done) {
        await supabase.schema("web-hub").from("crawl_jobs").update({ status: "in_progress", error_message: "Polling timed out" }).eq("id", crawlJob.id);
        return json({ success: true, crawl_job_id: crawlJob.id, message: "in_progress" }, 202);
      }

      // Map Firecrawl's actual response to our canonical storage shape.
      // Firecrawl puts title under metadata; markdown at the root;
      // links as a top-level array.
      const contentItems = pages.map((r) => ({
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
      await supabase.schema("web-hub").from("crawl_jobs").update({
        status: "complete", pages_crawled: contentItems.length,
        completed_at: new Date().toISOString(), crawl_results: contentItems, duration_seconds: durSec,
      }).eq("id", crawlJob.id);

      try {
        await fetch(`${supabaseUrl}/functions/v1/copy-fixing`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
          body: JSON.stringify({ project_id: payload.project_id, crawl_job_id: crawlJob.id }),
        });
      } catch (e) { console.error("copy-fixing failed:", e); }

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
