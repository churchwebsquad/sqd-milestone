/**
 * Vercel Serverless Function — /api/church-intel/generate-social
 *
 * Social Church Intel generator.
 * Flow:
 *   1. Pull church record from Supabase (name, website, AM, instagram, facebook)
 *   2. FireCrawl scrapes the church website to extract all social links
 *   3. Claude researches each social platform and builds the 8-section profile
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   FIRECRAWL_API_KEY
 *   ANTHROPIC_API_KEY
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v1/scrape'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const firecrawlKey = process.env.FIRECRAWL_API_KEY
  const supabaseUrl  = process.env.SUPABASE_URL
  const supabaseKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
  if (!firecrawlKey) return res.status(500).json({ error: 'FIRECRAWL_API_KEY not configured' })
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase env not configured' })

  try {
    const { memberId, amNotes } = req.body as { memberId: number; amNotes?: string }
    if (!memberId) return res.status(400).json({ error: 'memberId is required' })

    // ── 1. Pull church record from Supabase ──────────────────────────
    const headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    }

    const [progressRes, acctRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/strategy_account_progress?member=eq.${memberId}&select=member,church_name,church_website,css_rep&limit=1`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/accounts?account=eq.${memberId}&select=account,instagram,facebook&limit=1`,
        { headers }
      ),
    ])

    const [progressData, acctData] = await Promise.all([progressRes.json(), acctRes.json()])
    const church = progressData?.[0]
    const acct   = acctData?.[0]

    if (!church) return res.status(404).json({ error: `No church found for member ${memberId}` })

    const churchName    = church.church_name ?? 'Unknown Church'
    const websiteUrl    = church.church_website ?? ''
    const amName        = church.css_rep ?? ''
    const igFromDb      = acct?.instagram ?? ''
    const fbFromDb      = acct?.facebook  ?? ''

    // ── 2. FireCrawl: scrape website to extract social links ─────────
    let crawledMarkdown = ''
    let instagram = igFromDb
    let facebook  = fbFromDb
    let youtube   = ''
    let tiktok    = ''

    if (websiteUrl) {
      try {
        const scrapeRes = await fetch(FIRECRAWL_SCRAPE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${firecrawlKey}` },
          body: JSON.stringify({
            url: websiteUrl,
            formats: ['markdown', 'links'],
            onlyMainContent: false,
          }),
        })

        if (scrapeRes.ok) {
          const scrapeData = await scrapeRes.json()
          const page = scrapeData?.data ?? scrapeData
          crawledMarkdown = page?.markdown ?? ''
          const allLinks: string[] = Array.isArray(page?.links) ? page.links : []
          const allText = crawledMarkdown + '\n' + allLinks.join('\n')

          const extractLink = (pattern: RegExp) => {
            const m = allText.match(pattern)
            return m ? m[0].replace(/[).,;]+$/, '') : ''
          }

          if (!instagram) instagram = extractLink(/https?:\/\/(?:www\.)?instagram\.com\/[\w\-.]+/i)
          if (!facebook)  facebook  = extractLink(/https?:\/\/(?:www\.)?facebook\.com\/[\w\-./]+/i)
          youtube  = extractLink(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[\w\-.]+|channel\/[\w\-]+|c\/[\w\-]+)/i)
          tiktok   = extractLink(/https?:\/\/(?:www\.)?tiktok\.com\/@[\w\-.]+/i)
        }
      } catch (e) {
        console.warn('[generate-social] FireCrawl scrape failed, continuing without it:', e)
      }
    }

    // ── 3. Claude builds the profile ─────────────────────────────────
    const socialLinks = [
      websiteUrl && `Website: ${websiteUrl}`,
      instagram  && `Instagram: ${instagram}`,
      facebook   && `Facebook: ${facebook}`,
      youtube    && `YouTube: ${youtube}`,
      tiktok     && `TikTok: ${tiktok}`,
    ].filter(Boolean).join('\n')

    const systemPrompt = `You are a church social media research assistant for Church Media Squad.
Your job is to research a church thoroughly and build a Social Church Intel Profile.
Every insight must come from something real you found — never fill gaps with generic church language.
You MUST respond with ONLY a valid JSON object. No introduction, no explanation, no markdown fences, no text before or after the JSON.`

    const userPrompt = `Build a Social Church Intel Profile for this church:

Church Name: ${churchName}
Partnership ID: ${memberId}
Account Manager: ${amName || 'Not assigned'}
${amNotes ? `AM Notes: ${amNotes}` : ''}

CONFIRMED SOCIAL LINKS (use these directly — do not guess alternate URLs):
${socialLinks || 'No links found — research using web_search based on the church name.'}

WEBSITE CONTENT (extracted from their site):
${crawledMarkdown ? crawledMarkdown.slice(0, 8000) : 'No website content available.'}

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
      "date": "${new Date().toISOString().slice(0, 10)}",
      "what": "Initial Social Intel Profile generated",
      "sources": []
    }
  ]
}`

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      console.error('[generate-social] Anthropic error:', errText)
      return res.status(502).json({ error: 'AI generation failed', details: errText })
    }

    const anthropicData = await anthropicRes.json()

    // Extract text from the response (may include tool use blocks)
    let rawText = ''
    for (const block of anthropicData.content ?? []) {
      if (block.type === 'text') rawText += block.text
    }

    // Strip <cite> tags injected by web_search
    rawText = rawText.replace(/<cite[^>]*>.*?<\/cite>/gs, '').trim()

    // Parse JSON
    let profile: unknown
    try {
      profile = JSON.parse(rawText)
    } catch {
      // Try to extract JSON block from surrounding text
      const match = rawText.match(/\{[\s\S]*\}/)
      if (!match) {
        console.error('[generate-social] No JSON found in response:', rawText.slice(0, 500))
        return res.status(502).json({ error: 'AI did not return valid JSON', raw: rawText.slice(0, 500) })
      }
      try {
        profile = JSON.parse(match[0])
      } catch (e2) {
        return res.status(502).json({ error: 'AI returned malformed JSON', raw: rawText.slice(0, 500) })
      }
    }

    return res.status(200).json({
      profile,
      meta: { churchName, memberId, instagram, facebook, youtube, tiktok, websiteUrl },
    })
  } catch (err: any) {
    console.error('[generate-social] Unexpected error:', err)
    return res.status(500).json({ error: 'Internal server error', details: err?.message })
  }
}
