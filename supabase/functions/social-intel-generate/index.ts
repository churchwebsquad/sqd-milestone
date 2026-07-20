// social-intel-generate — Supabase Edge Function
//
// Builds a Social Church Intel Profile for a given church member ID.
// Flow:
//   1. Pull church record from Supabase (core fields, brand guide, milestone history, contacts)
//   2. Fetch extracted brand profile from Squad API (real colors, fonts, logos from Dropbox)
//   3. Search Notion for any pages/docs mentioning the church
//   4. FireCrawl scrapes the church website to extract social links + content
//   5. Claude receives everything and builds the 8-section profile with web_search for socials
//
// Secrets required:
//   ANTHROPIC_API_KEY
//   FIRECRAWL_API_KEY
//   SQUAD_API_KEY         — Squad API key (Authorization: Bearer)
//   NOTION_TOKEN          (already set — shared with strategy-notion function)
// Built-in:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_URL    = "https://api.anthropic.com/v1/messages";
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";
const NOTION_API_BASE      = "https://api.notion.com/v1";
const NOTION_VERSION       = "2022-06-28";
const SQUAD_API_BASE       = "https://api.thesqd.com";

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

// ── Squad API — brand profile ─────────────────────────────────────────────────

interface SquadBrandColor  { hex: string; name: string | null; role: string | null }
interface SquadBrandFont   { role: string; family: string; styles: string[]; adobe_url: string | null }
interface SquadBrandLogo   { file_name: string; url: string; meta: Record<string, unknown> }
interface SquadBrandProfile {
  colors: SquadBrandColor[];
  fonts:  SquadBrandFont[];
  logos:  SquadBrandLogo[];
  notes:  string | null;
  card_url: string | null;
  status: string;
}

async function fetchBrandProfile(accountId: number, squadApiKey: string): Promise<SquadBrandProfile | null> {
  try {
    const res = await fetch(`${SQUAD_API_BASE}/v1/image-gen/branding/${accountId}`, {
      headers: { Authorization: `Bearer ${squadApiKey}` },
    });
    if (res.status === 404) return null; // No brand profile extracted yet — not an error
    if (!res.ok) {
      console.warn("[social-intel] Squad brand API HTTP", res.status);
      return null;
    }
    return await res.json() as SquadBrandProfile;
  } catch (e) {
    console.warn("[social-intel] Squad brand API failed:", e);
    return null;
  }
}

function formatBrandProfile(brand: SquadBrandProfile | null): string {
  if (!brand) return "Squad Brand API: No response.";
  const lines: string[] = [`Status: ${brand.status}`];
  if (brand.colors.length) {
    lines.push("Colors:");
    for (const c of brand.colors) {
      lines.push(`  ${c.hex}${c.name ? ` — ${c.name}` : ""}${c.role ? ` (${c.role})` : ""}`);
    }
  } else {
    lines.push("Colors: none found");
  }
  if (brand.fonts.length) {
    lines.push("Fonts:");
    for (const f of brand.fonts) {
      lines.push(`  ${f.family}${f.styles.length ? ` ${f.styles.join(", ")}` : ""} — ${f.role}${f.adobe_url ? ` [${f.adobe_url}]` : ""}`);
    }
  } else {
    lines.push("Fonts: none found");
  }
  if (brand.logos.length) {
    lines.push(`Logos on file: ${brand.logos.map(l => l.file_name).join(", ")}`);
  }
  if (brand.notes) lines.push(`Notes: ${brand.notes}`);
  return lines.join("\n");
}

// ── Brand fallback — extract colors/fonts from website HTML ──────────────────

function extractBrandFromHtml(html: string): { colors: string[]; fonts: string[] } {
  const colors: string[] = [];
  const fonts: string[] = [];

  // Google Fonts links → font family names
  const gfMatches = html.matchAll(/family=([^&"'\s]+)/g);
  for (const m of gfMatches) {
    const name = decodeURIComponent(m[1]).replace(/[+:]/g, " ").split(" ").slice(0, 3).join(" ").trim();
    if (name && !fonts.includes(name)) fonts.push(name);
  }

  // meta theme-color
  const themeMatch = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{3,6})["']/i)
    ?? html.match(/content=["'](#[0-9a-fA-F]{3,6})["'][^>]+name=["']theme-color["']/i);
  if (themeMatch) colors.push(themeMatch[1] + " (meta theme-color)");

  // CSS custom properties  --color-*, --brand-*, --primary*, --secondary*
  const cssVarMatches = html.matchAll(/--(?:color|brand|primary|secondary|accent)[^:]*:\s*(#[0-9a-fA-F]{3,6})/gi);
  const cssColors = new Set<string>();
  for (const m of cssVarMatches) {
    cssColors.add(m[1].toLowerCase());
  }
  // Inline or style-block hex colors that appear 3+ times (recurring = likely brand)
  const hexCounts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const h = "#" + m[1].toLowerCase();
    hexCounts.set(h, (hexCounts.get(h) ?? 0) + 1);
  }
  for (const [hex, count] of hexCounts) {
    if (count >= 3 && !["#ffffff", "#000000", "#f5f5f5", "#333333", "#666666"].includes(hex)) {
      cssColors.add(hex);
    }
  }
  colors.push(...Array.from(cssColors).slice(0, 8));

  return { colors, fonts };
}

// ── Brand fallback — scrape prf_brand_guides URL via Firecrawl ───────────────

async function scrapeBrandGuideUrl(url: string, firecrawlKey: string): Promise<string> {
  try {
    const res = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    if (!res.ok) return "";
    const d = await res.json();
    const page = d?.data ?? d;
    return (page?.markdown ?? "").slice(0, 3000) as string;
  } catch {
    return "";
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  const anthropicKey  = Deno.env.get("ANTHROPIC_API_KEY");
  const firecrawlKey  = Deno.env.get("FIRECRAWL_API_KEY");
  const notionToken   = Deno.env.get("NOTION_TOKEN");
  const supabaseUrl   = Deno.env.get("SUPABASE_URL");
  const supabaseKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // Squad API accepts either a dedicated API key or the user's Supabase JWT
  const squadApiKey   = Deno.env.get("SQUAD_API_KEY") ?? Deno.env.get("STRATEGY_SQUAD_API_KEY") ?? req.headers.get("authorization")?.replace("Bearer ", "") ?? undefined;

  if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY secret not set" }, 500);
  if (!firecrawlKey) return json({ error: "FIRECRAWL_API_KEY secret not set" }, 500);

  const supabase = createClient(supabaseUrl!, supabaseKey!);

  let memberId: number;
  let amNotes: string | undefined;
  let brandGuideUrlOverride: string | undefined;
  let section: string | undefined;
  try {
    const body = await req.json();
    memberId = Number(body.memberId);
    amNotes  = body.amNotes;
    brandGuideUrlOverride = body.brandGuideUrl || undefined;
    section  = body.section || undefined; // e.g. 'whats_happening_now'
    if (!memberId) return json({ error: "memberId is required" }, 400);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // ── Targeted section refresh (fast path) ─────────────────────────────────
  if (section === "whats_happening_now") {
    const supabase = createClient(supabaseUrl!, supabaseKey!);
    const [{ data: progressData }, { data: proData }] = await Promise.all([
      supabase.from("strategy_account_progress").select("church_name, church_website").eq("member", memberId).maybeSingle(),
      supabase.from("strategy_social_pro_profiles").select("church_name, website").eq("member", memberId).maybeSingle(),
    ]);
    const churchRow = progressData ?? proData;
    if (!churchRow) return json({ error: `No church found for member ${memberId}` }, 404);
    const churchName = (churchRow as Record<string, unknown>).church_name as string ?? "";
    const websiteUrl = ((churchRow as Record<string, unknown>).church_website ?? (churchRow as Record<string, unknown>).website) as string ?? "";

    // Scrape website for current series/events
    let crawlMarkdown = "";
    if (websiteUrl && firecrawlKey) {
      try {
        const scrapeRes = await fetch(FIRECRAWL_SCRAPE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
          body: JSON.stringify({ url: websiteUrl, formats: ["markdown"], onlyMainContent: false }),
        });
        if (scrapeRes.ok) {
          const d = await scrapeRes.json();
          crawlMarkdown = ((d?.data ?? d)?.markdown ?? "") as string;
        }
      } catch { /* silent */ }
    }

    const today = new Date().toISOString().slice(0, 10);
    const nowPrompt = `Research what is currently happening at ${churchName} (church website: ${websiteUrl || "unknown"}).

Website content (scraped):
${crawlMarkdown ? crawlMarkdown.slice(0, 5000) : "Not available."}

Using the above AND web_search, find:
- Current sermon series name and week number
- Any upcoming events in the next 4–6 weeks (with dates if visible)
- Any recent notable changes (new staff, rebrand, new campus, new service times, etc.)

Return ONLY this JSON — no explanation, no markdown fences:
{
  "current_series": "",
  "series_week": "",
  "upcoming_events": [],
  "recent_changes": "",
  "am_notes": "",
  "refreshed_at": "${today}"
}`;

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: nowPrompt }],
      }),
    });

    if (!anthropicRes.ok) return json({ error: "AI request failed" }, 502);
    const anthropicData = await anthropicRes.json();
    let rawText = "";
    for (const block of anthropicData.content ?? []) {
      if (block.type === "text") rawText += block.text;
    }
    rawText = rawText.replace(/<cite[^>]*>.*?<\/cite>/gs, "").trim();
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      const whatsHappeningNow = JSON.parse(match ? match[0] : rawText);
      return json({ whats_happening_now: whatsHappeningNow });
    } catch {
      return json({ error: "AI returned malformed JSON", raw: rawText.slice(0, 300) }, 502);
    }
  }

  // ── 1. Supabase — pull everything we have on this church ──────────────────

  const [
    { data: progressData },
    { data: proData },
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
      .from("strategy_social_pro_profiles")
      .select("member, church_name, website, css_rep")
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
      .eq("account", memberId)
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

  // Support non-all-in churches that live in strategy_social_pro_profiles
  const churchRow = progressData ?? proData;
  if (!churchRow) return json({ error: `No church found for member ${memberId}` }, 404);

  const rec = churchRow as Record<string, unknown>;
  const churchName = rec.church_name as string ?? "Unknown Church";
  const websiteUrl = (rec.church_website ?? rec.website) as string ?? "";
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

  // ── 2. Squad brand API + Notion + FireCrawl — run in parallel ───────────────

  const [brandProfile, notionResults, crawlResult] = await Promise.all([

    squadApiKey
      ? fetchBrandProfile(memberId, squadApiKey)
      : Promise.resolve(null),

    notionToken
      ? notionSearch(churchName, notionToken)
      : Promise.resolve("NOTION_TOKEN not set — skipped."),

    websiteUrl
      ? (async () => {
          try {
            const scrapeRes = await fetch(FIRECRAWL_SCRAPE_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
              body: JSON.stringify({ url: websiteUrl, formats: ["markdown", "rawHtml", "links"], onlyMainContent: false }),
            });
            if (!scrapeRes.ok) return { markdown: "", rawHtml: "", links: [] };
            const d = await scrapeRes.json();
            const page = d?.data ?? d;
            return { markdown: (page?.markdown ?? "") as string, rawHtml: (page?.rawHtml ?? "") as string, links: (page?.links ?? []) as string[] };
          } catch {
            return { markdown: "", rawHtml: "", links: [] };
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
  youtube  = extractLink(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w-.]+|channel\/[\w-]+|c\/[\w-]+)/i);
  tiktok   = extractLink(/https?:\/\/(?:www\.)?tiktok\.com\/@[\w\-.]+/i);

  const socialLinks = [
    websiteUrl && `Website: ${websiteUrl}`,
    instagram  && `Instagram: ${instagram}`,
    facebook   && `Facebook: ${facebook}`,
    youtube    && `YouTube: ${youtube}`,
    tiktok     && `TikTok: ${tiktok}`,
  ].filter(Boolean).join("\n");

  // ── 2b. Brand fallback chain ─────────────────────────────────────────────
  // If Squad Brand API returned nothing useful (null, or partial with no fonts/colors),
  // try: (1) scrape the prf_brand_guides URL, (2) extract from website HTML.

  const squadHasColors = brandProfile && brandProfile.colors.length > 0;
  const squadHasFonts  = brandProfile && brandProfile.fonts.length > 0;
  const needsFallback  = !squadHasColors || !squadHasFonts;

  let brandGuideFallbackText = "";
  let websiteBrandFallback: { colors: string[]; fonts: string[] } = { colors: [], fonts: [] };

  if (needsFallback && firecrawlKey) {
    // Fallback 1: scrape the brand guide URL from prf_brand_guides if we have one
    const brandGuideUrl = brandGuideUrlOverride
      ?? (brandGuideData as Record<string, unknown> | null)?.brand_guide_link as string | undefined
      ?? (brandGuideData as Record<string, unknown> | null)?.url as string | undefined
      ?? (brandGuideData as Record<string, unknown> | null)?.guide_url as string | undefined;

    if (brandGuideUrl) {
      console.log("[social-intel] Brand fallback 1: scraping prf_brand_guides URL");
      brandGuideFallbackText = await scrapeBrandGuideUrl(brandGuideUrl, firecrawlKey);
    }

    // Fallback 2: extract colors/fonts from raw HTML (markdown loses CSS/meta tags)
    if (crawlResult.rawHtml) {
      console.log("[social-intel] Brand fallback 2: extracting from website rawHtml");
      websiteBrandFallback = extractBrandFromHtml(crawlResult.rawHtml);
    }
  }

  // Build the combined brand context string for the prompt
  const squadBrandText = formatBrandProfile(brandProfile);
  const fallbackSections: string[] = [];

  if (!squadHasColors || !squadHasFonts) {
    if (brandGuideFallbackText) {
      fallbackSections.push(`BRAND GUIDE FALLBACK (scraped from prf_brand_guides URL):\n${brandGuideFallbackText}`);
    }
    const wbColors = websiteBrandFallback.colors.filter(Boolean);
    const wbFonts  = websiteBrandFallback.fonts.filter(Boolean);
    if (wbColors.length || wbFonts.length) {
      const lines = ["WEBSITE HTML FALLBACK (extracted from CSS/Google Fonts):"];
      if (wbColors.length) lines.push("  Colors found: " + wbColors.join(", "));
      if (wbFonts.length)  lines.push("  Fonts found: "  + wbFonts.join(", "));
      fallbackSections.push(lines.join("\n"));
    }
  }

  const fullBrandContext = [
    `SQUAD BRAND PROFILE (from Squad Brand API — primary source):\n${squadBrandText}`,
    ...fallbackSections,
    fallbackSections.length > 0
      ? "NOTE: Use Squad Brand API data first. Fill any gaps from the fallback sources above, labeling the source."
      : "",
  ].filter(Boolean).join("\n\n");

  // ── 3. Claude builds the profile from everything ──────────────────────────

  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = `You are a church social media research assistant for Church Media Squad.
Your job is to research a church thoroughly and build a Social Church Intel Profile.
You have access to internal CMS data (Supabase, Notion, Squad brand API) AND can search the web.
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

${fullBrandContext}

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

Use the Squad brand profile above for exact colors, fonts, and logo details — do not guess these from the website.

═══ DESIGN NOTES INSTRUCTIONS ═══

The design_notes section must be sourced exclusively from the SQUAD BRAND PROFILE data above — never guess colors or fonts from the website or logos.

primary_colors / accent_colors — Use the exact hex values from the Squad Brand API. If status is "partial" or the error field says colors were sampled from a logo rather than a full brand guide, note that in visual_style: "Colors sourced from Squad Brand API (logo sample only — no full brand guide on file)." If a full brand guide was found, say "Colors sourced from Squad Brand API."

font_suggestions — Use only fonts listed in the Squad Brand API response. If fonts array is empty, write "Not identified in Squad Brand API — request brand guide from church."

brand_profile_source — Always set this to "Squad Brand API" regardless of whether the data is full or partial.

═══ BRAND VOICE INSTRUCTIONS ═══

The brand_voice section is the most important part of this profile. Write it like a professional social media strategist who has studied this church deeply.

tone_summary — Write 2-3 sentences describing the overall voice in plain English. Give it a memorable label (e.g. "family formal warmth", "bold and pastoral"). Describe how it feels to read their content, what makes them distinct, and what implicit promise the voice makes to their audience. Be specific — do not write generic things like "friendly and engaging."

attributes — Write 3-4 named voice attributes. Each attribute needs:
  - name: A short, memorable label (e.g. "Family Formal", "Biblically Rooted")
  - definition: 1-2 sentences explaining what this attribute means for this church specifically
  - write_with_this_in_mind: 1-2 sentences of concrete copywriting guidance — what to do and what to avoid when writing in this voice
  - use: 6-10 specific words or short phrases this church actually uses or should use
  - avoid: 6-10 words, phrases, or patterns that would feel off-brand for this church

casual_to_formal_spectrum — One sentence placing them on the spectrum (e.g. "Sits at a 6/10 on the formal scale — warmer than a seminary but more grounded than a megachurch hype account.")

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
    "am_notes": "",
    "refreshed_at": "${today}"
  },
  "cms_history": {
    "milestones_completed": [],
    "last_delivery": "",
    "brand_guide_on_file": "",
    "brand_profile_source": "",
    "notion_notes_summary": ""
  },
  "brand_voice": {
    "tone_summary": "",
    "attributes": [
      { "name": "", "definition": "", "write_with_this_in_mind": "", "use": [], "avoid": [] }
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
      messages: [{ role: "user", content: userPrompt }],
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

  // Inject brand card URL directly — AI doesn't reliably include URLs in JSON
  if (brandProfile?.card_url && profile && typeof profile === "object") {
    const p = profile as Record<string, unknown>;
    p.design_notes = { ...(p.design_notes as Record<string, unknown> ?? {}), brand_card_url: brandProfile.card_url };
  }

  return json({
    profile,
    meta: {
      churchName, memberId, instagram, facebook, youtube, tiktok, websiteUrl,
      sourcesUsed: {
        supabase: true,
        notion: !!notionToken,
        brandProfileLoaded: !!brandProfile,
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
