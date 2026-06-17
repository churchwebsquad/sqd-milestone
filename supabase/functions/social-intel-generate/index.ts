// social-intel-generate — Supabase Edge Function
//
// Builds a Social Church Intel Profile for a given church member ID.
// Flow:
//   1. Pull church record from Supabase (name, website, AM, instagram, facebook)
//   2. FireCrawl scrapes the church website to extract all social links
//   3. Claude researches each social platform and builds the 8-section profile
//
// Secrets required (set in Supabase dashboard → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY
//   FIRECRAWL_API_KEY
// Built-in (auto-available in all Edge Functions):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  const supabaseUrl  = Deno.env.get("SUPABASE_URL");
  const supabaseKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

  // ── 1. Pull church record from Supabase ────────────────────────────
  const [{ data: progressData }, { data: acctData }] = await Promise.all([
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
  ]);

  if (!progressData) return json({ error: `No church found for member ${memberId}` }, 404);

  const churchName = (progressData as Record<string, unknown>).church_name as string ?? "Unknown Church";
  const websiteUrl = (progressData as Record<string, unknown>).church_website as string ?? "";
  const amName     = (progressData as Record<string, unknown>).css_rep as string ?? "";
  const igFromDb   = (acctData as Record<string, unknown> | null)?.instagram as string ?? "";
  const fbFromDb   = (acctData as Record<string, unknown> | null)?.facebook  as string ?? "";

  // ── 2. FireCrawl: scrape website to extract social links ───────────
  let crawledMarkdown = "";
  let instagram = igFromDb;
  let facebook  = fbFromDb;
  let youtube   = "";
  let tiktok    = "";

  if (websiteUrl) {
    try {
      const scrapeRes = await fetch(FIRECRAWL_SCRAPE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
        body: JSON.stringify({
          url: websiteUrl,
          formats: ["markdown", "links"],
          onlyMainContent: false,
        }),
      });

      if (scrapeRes.ok) {
        const scrapeData = await scrapeRes.json();
        const page = scrapeData?.data ?? scrapeData;
        crawledMarkdown = page?.markdown ?? "";
        const allLinks: string[] = Array.isArray(page?.links) ? page.links : [];
        const allText = crawledMarkdown + "\n" + allLinks.join("\n");

        const extractLink = (pattern: RegExp): string => {
          const m = allText.match(pattern);
          return m ? m[0].replace(/[).,;]+$/, "") : "";
        };

        if (!instagram) instagram = extractLink(/https?:\/\/(?:www\.)?instagram\.com\/[\w\-.]+/i);
        if (!facebook)  facebook  = extractLink(/https?:\/\/(?:www\.)?facebook\.com\/[\w\-./]+/i);
        youtube  = extractLink(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w\-.]+|channel\/[\w\-]+|c\/[\w\-]+)/i);
        tiktok   = extractLink(/https?:\/\/(?:www\.)?tiktok\.com\/@[\w\-.]+/i);
      }
    } catch (e) {
      console.warn("[social-intel-generate] FireCrawl scrape failed, continuing:", e);
    }
  }

  // ── 3. Claude builds the 8-section profile ─────────────────────────
  const socialLinks = [
    websiteUrl && `Website: ${websiteUrl}`,
    instagram  && `Instagram: ${instagram}`,
    facebook   && `Facebook: ${facebook}`,
    youtube    && `YouTube: ${youtube}`,
    tiktok     && `TikTok: ${tiktok}`,
  ].filter(Boolean).join("\n");

  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = `You are a church social media research assistant for Church Media Squad.
Your job is to research a church thoroughly and build a Social Church Intel Profile.
Every insight must come from something real you found — never fill gaps with generic church language.
You MUST respond with ONLY a valid JSON object. No introduction, no explanation, no markdown fences, no text before or after the JSON.`;

  const userPrompt = `Build a Social Church Intel Profile for this church:

Church Name: ${churchName}
Partnership ID: ${memberId}
Account Manager: ${amName || "Not assigned"}
${amNotes ? `AM Notes: ${amNotes}` : ""}

CONFIRMED SOCIAL LINKS (use these directly):
${socialLinks || "No links found — research using web_search based on the church name."}

WEBSITE CONTENT (extracted from their site):
${crawledMarkdown ? crawledMarkdown.slice(0, 8000) : "No website content available."}

---

RESEARCH INSTRUCTIONS:
Using the social links above, research each platform thoroughly via web_search:

Instagram — caption style and tone, CTA patterns (pull actual language from real posts), hashtag usage, what content gets engagement, how formal or casual they are.

Facebook — how they write compared to Instagram, post length, how they open and close, what their audience responds to.

YouTube — current sermon series name and week number, pastor's teaching style and energy on camera, whether there is usable worship footage.

Website — how they describe themselves, pastor and key staff names, upcoming events with dates, what series they're in, anything notable about their About or Beliefs page.

After researching, build the profile with exactly these 8 sections as a JSON object:

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
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    console.error("[social-intel-generate] Anthropic error:", errText);
    return json({ error: "AI generation failed", details: errText }, 502);
  }

  const anthropicData = await anthropicRes.json();

  // Extract text from response (may include tool_use blocks between web searches)
  let rawText = "";
  for (const block of anthropicData.content ?? []) {
    if (block.type === "text") rawText += block.text;
  }

  // Strip <cite> tags injected by web_search
  rawText = rawText.replace(/<cite[^>]*>.*?<\/cite>/gs, "").trim();

  // Parse JSON
  let profile: unknown;
  try {
    profile = JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("[social-intel-generate] No JSON in response:", rawText.slice(0, 500));
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
    meta: { churchName, memberId, instagram, facebook, youtube, tiktok, websiteUrl },
  }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
