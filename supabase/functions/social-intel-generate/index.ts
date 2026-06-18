// social-intel-generate — Supabase Edge Function
//
// Builds a Social Church Intel Profile for a given church member ID.
// Flow:
//   1. Pull church record from Supabase (core fields, brand guide, milestone history, contacts)
//   2. Search Notion for any pages/docs mentioning the church
//   3. Search Dropbox for any files/folders for the church (graceful if token missing)
//   4. FireCrawl scrapes the church website to extract social links + content
//   5. Claude receives everything and builds the 8-section profile with web_search for socials
//
// Secrets required:
//   ANTHROPIC_API_KEY
//   FIRECRAWL_API_KEY
//   NOTION_TOKEN          (already set — shared with strategy-notion function)
//   DROPBOX_ACCESS_TOKEN  (optional — skipped gracefully if absent)
// Built-in:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_URL   = "https://api.anthropic.com/v1/messages";
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";
const NOTION_API_BASE      = "https://api.notion.com/v1";
const NOTION_VERSION       = "2022-06-28";
const DROPBOX_SEARCH_URL   = "https://api.dropboxapi.com/2/files/search_v2";

// ── Notion helpers ────────────────────────────────────────────────────────────

async function notionSearch(query: string, notionToken: string): Promise<string> {
  try {
    const res = await fetch(`${NOTION_API_BASE}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, page_size: 10 }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const results = data.results ?? [];
    if (!results.length) return "";

    const lines: string[] = [];
    for (const page of results) {
      const title = extractNotionTitle(page);
      const url   = page.url ?? "";
      const type  = page.object ?? "";
      const lastEdited = page.last_edited_time ?? "";
      lines.push(`- [${type}] ${title} (${lastEdited}) ${url}`);

      // Pull block content for pages (first 30 blocks = enough for context)
      if (page.object === "page") {
        const content = await notionPageContent(page.id, notionToken);
        if (content) lines.push(`  Content: ${content.slice(0, 800)}`);
      }
    }
    return lines.join("\n");
  } catch (e) {
    console.warn("[social-intel] Notion search failed:", e);
    return "";
  }
}

function extractNotionTitle(page: Record<string, unknown>): string {
  const props = (page.properties as Record<string, unknown>) ?? {};
  for (const key of ["Name", "Title", "title", "name"]) {
    const prop = props[key] as Record<string, unknown> | undefined;
    if (!prop) continue;
    const titleArr = (prop.title ?? prop.rich_text) as Array<{ plain_text?: string }> | undefined;
    if (Array.isArray(titleArr)) return titleArr.map(t => t.plain_text ?? "").join("") || "(untitled)";
  }
  return "(untitled)";
}

async function notionPageContent(pageId: string, notionToken: string): Promise<string> {
  try {
    const res = await fetch(`${NOTION_API_BASE}/blocks/${pageId}/children?page_size=30`, {
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": NOTION_VERSION,
      },
    });
    if (!res.ok) return "";
    const data = await res.json();
    const blocks = data.results ?? [];
    return blocks
      .map((b: Record<string, unknown>) => {
        const type = b.type as string;
        const block = (b[type] as Record<string, unknown>) ?? {};
        const richText = (block.rich_text ?? block.text) as Array<{ plain_text?: string }> | undefined;
        if (Array.isArray(richText)) return richText.map(t => t.plain_text ?? "").join("");
        return "";
      })
      .filter(Boolean)
      .join(" ");
  } catch {
    return "";
  }
}

// ── Dropbox helpers ───────────────────────────────────────────────────────────

interface DropboxFile {
  path: string;
  name: string;
  size: number;
}

interface DropboxBrandAsset {
  fileListing: string;
  brandPdfs: Array<{ name: string; base64: string }>;
}

const DROPBOX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
const BRAND_GUIDE_PATTERN  = /brand|guide|identity|style|logo|visual/i;
const MAX_PDF_BYTES        = 20 * 1024 * 1024; // 20 MB

async function dropboxSearch(query: string, dropboxToken: string): Promise<DropboxBrandAsset> {
  const empty: DropboxBrandAsset = { fileListing: "", brandPdfs: [] };
  try {
    const res = await fetch(DROPBOX_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${dropboxToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, options: { max_results: 20, file_status: "active" } }),
    });
    if (!res.ok) {
      console.warn("[social-intel] Dropbox search HTTP", res.status, await res.text());
      return empty;
    }
    const data = await res.json();
    const matches: Record<string, unknown>[] = data.matches ?? [];
    if (!matches.length) return empty;

    const files: DropboxFile[] = matches
      .map((m) => {
        const meta = ((m.metadata as Record<string, unknown>)?.metadata ?? {}) as Record<string, unknown>;
        return {
          path: (meta.path_display ?? meta.path_lower ?? "") as string,
          name: (meta.name ?? "") as string,
          size: (meta.size ?? 0) as number,
        };
      })
      .filter((f) => f.path);

    const fileListing = files.map((f) => `- ${f.path}`).join("\n");

    // Download PDFs that look like brand guides (up to 2 files)
    const brandPdfFiles = files.filter(
      (f) => f.name.toLowerCase().endsWith(".pdf") && BRAND_GUIDE_PATTERN.test(f.name) && f.size <= MAX_PDF_BYTES
    ).slice(0, 2);

    const brandPdfs = (
      await Promise.all(
        brandPdfFiles.map(async (f) => {
          try {
            const dlRes = await fetch(DROPBOX_DOWNLOAD_URL, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${dropboxToken}`,
                "Dropbox-API-Arg": JSON.stringify({ path: f.path }),
              },
            });
            if (!dlRes.ok) {
              console.warn("[social-intel] Dropbox download failed for", f.path, dlRes.status);
              return null;
            }
            const buffer = await dlRes.arrayBuffer();
            const bytes   = new Uint8Array(buffer);
            // Encode to base64
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const base64 = btoa(binary);
            console.log(`[social-intel] Downloaded brand PDF: ${f.name} (${Math.round(bytes.length / 1024)}KB)`);
            return { name: f.name, base64 };
          } catch (e) {
            console.warn("[social-intel] Dropbox download error for", f.path, e);
            return null;
          }
        })
      )
    ).filter((x): x is { name: string; base64: string } => x !== null);

    return { fileListing, brandPdfs };
  } catch (e) {
    console.warn("[social-intel] Dropbox search failed:", e);
    return empty;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  const anthropicKey  = Deno.env.get("ANTHROPIC_API_KEY");
  const firecrawlKey  = Deno.env.get("FIRECRAWL_API_KEY");
  const notionToken   = Deno.env.get("NOTION_TOKEN");
  const dropboxToken  = Deno.env.get("DROPBOX_ACCESS_TOKEN");
  const supabaseUrl   = Deno.env.get("SUPABASE_URL");
  const supabaseKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY secret not set" }, 500);
  if (!firecrawlKey) return json({ error: "FIRECRAWL_API_KEY secret not set" }, 500);

  const supabase = createClient(supabaseUrl!, supabaseKey!);

  let memberId: number;
  let amNotes: string | undefined;
  try {
    const body = await req.json();
    memberId = Number(body.memberId);
    amNotes  = body.amNotes;
    if (!memberId) return json({ error: "memberId is required" }, 400);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // ── 1. Supabase — pull everything we have on this church ──────────────────

  const [
    { data: progressData },
    { data: acctData },
    { data: brandGuideData },
    { data: milestonesData },
    { data: contactsData },
  ] = await Promise.all([
    supabase
      .from("strategy_account_progress")
      .select("member, church_name, church_website, css_rep")
      .eq("member", memberId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("accounts")
      .select("account, instagram, facebook")
      .eq("account", memberId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("prf_brand_guides")
      .select("*")
      .eq("member", memberId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("strategy_milestone_submissions")
      .select("milestone_name, squad, submitted_at, submitter_name, notes")
      .eq("member", memberId)
      .order("submitted_at", { ascending: false })
      .limit(20),
    supabase
      .from("clickup_users")
      .select("username, email, account_id")
      .eq("account_id", memberId)
      .is("employee", null),
  ]);

  if (!progressData) return json({ error: `No church found for member ${memberId}` }, 404);

  const rec = progressData as Record<string, unknown>;
  const churchName = rec.church_name as string ?? "Unknown Church";
  const websiteUrl = rec.church_website as string ?? "";
  const amName     = rec.css_rep as string ?? "";
  const igFromDb   = (acctData as Record<string, unknown> | null)?.instagram as string ?? "";
  const fbFromDb   = (acctData as Record<string, unknown> | null)?.facebook  as string ?? "";

  // Format Supabase context for the prompt
  const brandGuideText = brandGuideData
    ? `Brand guide on file: ${JSON.stringify(brandGuideData).slice(0, 1000)}`
    : "No brand guide on file in Supabase.";

  const milestonesText = (milestonesData ?? []).length > 0
    ? "Milestone/delivery history:\n" + (milestonesData ?? [])
        .map((m: Record<string, unknown>) =>
          `  - ${m.submitted_at ? String(m.submitted_at).slice(0, 10) : "?"} | ${m.squad} | ${m.milestone_name}${m.submitter_name ? ` (by ${m.submitter_name})` : ""}${m.notes ? ` — ${m.notes}` : ""}`)
        .join("\n")
    : "No milestone submissions on file.";

  const contactsText = (contactsData ?? []).length > 0
    ? "Partner contacts on file:\n" + (contactsData ?? [])
        .map((c: Record<string, unknown>) => `  - ${c.username ?? ""} <${c.email ?? ""}>`)
        .join("\n")
    : "No partner contacts on file.";

  // ── 2. Notion + Dropbox + FireCrawl — run in parallel ────────────────────

  const [notionResults, dropboxResults, crawlResult] = await Promise.all([

    notionToken
      ? notionSearch(churchName, notionToken)
      : Promise.resolve("NOTION_TOKEN not set — skipped."),

    dropboxToken
      ? dropboxSearch(churchName, dropboxToken)
      : Promise.resolve({ fileListing: "DROPBOX_ACCESS_TOKEN not set — flag for Josh.", brandPdfs: [] }),

    websiteUrl
      ? (async () => {
          try {
            const scrapeRes = await fetch(FIRECRAWL_SCRAPE_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
              body: JSON.stringify({ url: websiteUrl, formats: ["markdown", "links"], onlyMainContent: false }),
            });
            if (!scrapeRes.ok) return { markdown: "", links: [] };
            const d = await scrapeRes.json();
            const page = d?.data ?? d;
            return { markdown: (page?.markdown ?? "") as string, links: (page?.links ?? []) as string[] };
          } catch {
            return { markdown: "", links: [] };
          }
        })()
      : Promise.resolve({ markdown: "", links: [] }),
  ]);

  // Extract social links from crawl
  let instagram = igFromDb;
  let facebook  = fbFromDb;
  let youtube   = "";
  let tiktok    = "";

  const crawlText = crawlResult.markdown + "\n" + crawlResult.links.join("\n");
  const extractLink = (pattern: RegExp): string => {
    const m = crawlText.match(pattern);
    return m ? m[0].replace(/[).,;]+$/, "") : "";
  };
  if (!instagram) instagram = extractLink(/https?:\/\/(?:www\.)?instagram\.com\/[\w\-.]+/i);
  if (!facebook)  facebook  = extractLink(/https?:\/\/(?:www\.)?facebook\.com\/[\w\-./]+/i);
  youtube  = extractLink(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w\-.]+|channel\/[\w\-]+|c\/[\w\-]+)/i);
  tiktok   = extractLink(/https?:\/\/(?:www\.)?tiktok\.com\/@[\w\-.]+/i);

  const socialLinks = [
    websiteUrl && `Website: ${websiteUrl}`,
    instagram  && `Instagram: ${instagram}`,
    facebook   && `Facebook: ${facebook}`,
    youtube    && `YouTube: ${youtube}`,
    tiktok     && `TikTok: ${tiktok}`,
  ].filter(Boolean).join("\n");

  // ── 3. Claude builds the profile from everything ──────────────────────────

  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = `You are a church social media research assistant for Church Media Squad.
Your job is to research a church thoroughly and build a Social Church Intel Profile.
You have access to internal CMS data (Supabase, Notion, Dropbox) AND can search the web.
Every insight must come from something real — never fill gaps with generic church language.
You MUST respond with ONLY a valid JSON object. No introduction, no explanation, no markdown fences.`;

  const userPrompt = `Build a Social Church Intel Profile for this church.

Church Name: ${churchName}
Partnership ID: ${memberId}
Account Manager: ${amName || "Not assigned"}
${amNotes ? `AM Notes (from form): ${amNotes}` : ""}

═══ INTERNAL CMS DATA ═══

${brandGuideText}

${milestonesText}

${contactsText}

NOTION — Pages/docs found for this church:
${notionResults || "No Notion pages found for this church name."}

DROPBOX — Files found for this church:
${dropboxResults.fileListing || "No Dropbox files found."}
${dropboxResults.brandPdfs.length > 0 ? `Brand guide PDFs downloaded and included as documents: ${dropboxResults.brandPdfs.map(p => p.name).join(", ")}` : "No brand guide PDFs downloaded."}

CONFIRMED SOCIAL LINKS (from our database + website scrape):
${socialLinks || "No links found — research via web_search."}

WEBSITE CONTENT (scraped):
${crawlResult.markdown ? crawlResult.markdown.slice(0, 6000) : "No website content available."}

═══ RESEARCH INSTRUCTIONS ═══

Using the internal data above PLUS web_search, research each platform thoroughly:

Instagram — caption style and tone, CTA patterns (pull actual language from real posts), hashtag usage, what content gets engagement, how formal or casual they are.

Facebook — how they write compared to Instagram, post length, how they open and close, what their audience responds to.

YouTube — current sermon series name and week number, pastor's teaching style, whether there is usable worship footage.

Website + Notion docs — how they describe themselves, pastor and key staff names, upcoming events with dates, what series they're in, what CMS has already delivered to them (from milestone history), any strategy notes.

Use the Dropbox file list to note what brand assets or deliverables we have on file for them.

After researching, return ONLY this JSON:

{
  "church_overview": {
    "church_name": "",
    "partnership_id": "",
    "am_name": "",
    "website": "",
    "instagram": "",
    "facebook": "",
    "youtube": "",
    "tiktok": "",
    "pastor_name": "",
    "denomination": "",
    "location": ""
  },
  "whats_happening_now": {
    "current_series": "",
    "series_week": "",
    "upcoming_events": [],
    "recent_changes": "",
    "am_notes": ""
  },
  "cms_history": {
    "milestones_completed": [],
    "last_delivery": "",
    "brand_guide_on_file": "",
    "dropbox_assets_noted": "",
    "notion_notes_summary": ""
  },
  "brand_voice": {
    "tone_summary": "",
    "attributes": [
      { "name": "", "definition": "", "use": [], "avoid": [] }
    ],
    "casual_to_formal_spectrum": "",
    "cta_patterns": [],
    "pastor_reference": "",
    "church_self_reference": ""
  },
  "deliverables": {
    "sermon_reel": {
      "tone": "",
      "topic_approach": "",
      "thumbnail_guidance": "",
      "hashtags": "",
      "cta": ""
    },
    "worship_reel": {
      "recommendation": "",
      "reasoning": "",
      "emotional_vs_teaching": "",
      "caption_guidance": ""
    },
    "carousel": {
      "teaching_vs_poetic": "",
      "bible_verse_approach": "",
      "caption_length": "",
      "cta": ""
    },
    "invite_post": {
      "service_times": "",
      "locations": "",
      "online_option": "",
      "kids_ministry_language": ""
    },
    "recap_post": {
      "has_recap_history": "",
      "recap_focus": "",
      "recap_feel": ""
    },
    "facebook_text_post": {
      "format": "",
      "audience_response": "",
      "opening_pattern": "",
      "closing_pattern": ""
    }
  },
  "what_performs_well": {
    "summary": "",
    "top_content_types": [],
    "themes_that_land": [],
    "caption_style": "",
    "what_to_lean_into": "",
    "what_to_avoid": ""
  },
  "design_notes": {
    "primary_colors": [],
    "accent_colors": [],
    "visual_style": "",
    "font_suggestions": [],
    "photography_vs_illustrated": ""
  },
  "team_tips": "",
  "change_log": [
    {
      "date": "${today}",
      "what": "Initial Social Intel Profile generated",
      "sources": []
    }
  ]
}`;

  const anthropicRes = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          // Prepend any brand guide PDFs downloaded from Dropbox as document blocks
          ...dropboxResults.brandPdfs.map(pdf => ({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdf.base64 },
            title: `Brand Guide: ${pdf.name}`,
          })),
          { type: "text", text: userPrompt },
        ],
      }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    console.error("[social-intel] Anthropic error:", errText);
    return json({ error: "AI generation failed", details: errText }, 502);
  }

  const anthropicData = await anthropicRes.json();

  let rawText = "";
  for (const block of anthropicData.content ?? []) {
    if (block.type === "text") rawText += block.text;
  }
  rawText = rawText.replace(/<cite[^>]*>.*?<\/cite>/gs, "").trim();

  let profile: unknown;
  try {
    profile = JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("[social-intel] No JSON in response:", rawText.slice(0, 500));
      return json({ error: "AI did not return valid JSON", raw: rawText.slice(0, 500) }, 502);
    }
    try {
      profile = JSON.parse(match[0]);
    } catch {
      return json({ error: "AI returned malformed JSON", raw: rawText.slice(0, 500) }, 502);
    }
  }

  return json({
    profile,
    meta: {
      churchName, memberId, instagram, facebook, youtube, tiktok, websiteUrl,
      sourcesUsed: {
        supabase: true,
        notion: !!notionToken,
        dropbox: !!dropboxToken,
        dropboxBrandPdfsRead: dropboxResults.brandPdfs.map(p => p.name),
        firecrawl: !!websiteUrl,
      },
    },
  }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
