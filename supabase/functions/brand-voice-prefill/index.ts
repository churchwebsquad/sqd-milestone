// brand-voice-prefill — Supabase Edge Function
// Takes a strategy-brief markdown file (the Notion export the CMS team fills
// out per church) and returns a structured prefill payload that the editor
// can hydrate into the Brand Voice, Tone Characteristics, Voice Guidelines,
// and Brand Attributes sections of a brand guide.
//
// Anthropic key lives in Supabase secrets, never in the browser.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Keep this schema in sync with BrandVoicePrefillPayload on the client.
const SYSTEM_PROMPT = `You extract brand voice and positioning content from a church's strategy brief markdown and return it as JSON.

You MUST respond with ONLY a valid JSON object — no introduction, no explanation, no markdown, no text before or after the JSON. Your entire response must start with { and end with }.

The JSON shape is:
{
  "voice_overview": string,        // 1-3 sentences capturing the overall voice. Source: the paragraph under "# Brand Voice" that describes the voice (winsome/grounded/caring etc.). Trim stray unicode, keep it clean prose.
  "brand_statement": string,       // The single italicized sentence under "## Brand Statement" in the markdown. Strip quotes, asterisks, and italic markers.
  "tone_characteristics": [        // One per aside under "## Tone Characteristics". 2-5 items usually.
    { "title": string, "description": string }   // title is the H3 (e.g. "Relatable"). description is the explanatory paragraph(s), without the trailing bullet list.
  ],
  "voice_guidelines": [            // One per aside under "## Voice Guidelines". 3-5 items usually.
    { "title": string, "description": string }
  ],
  "brand_attributes": [            // Pull the TOP ATTRIBUTES from each of Culture / Audience / Voice / Feeling / Impact (under "# Attributes"). Use each item as "label" and compose a short description from the MESSAGING FOCUS paragraph for that category (shared across attributes from the same category is fine).
    { "label": string, "description": string }
  ]
}

Rules:
- Return empty arrays for any section you genuinely can't extract (do not fabricate).
- Description fields should be clean prose — no markdown bullets, no Notion icon prefixes, no stray unicode like â or âˆ.
- Keep descriptions under ~400 characters each.
- If the markdown is missing a section entirely, use "" for string fields and [] for arrays.`

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

    const body = await req.json()
    const { markdown } = body as { markdown?: string }

    if (!markdown || typeof markdown !== 'string' || markdown.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing `markdown` in request body.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Cap the markdown at ~60KB so we don't blow past Anthropic's token limit
    // on accidental paste-of-everything. Real strategy briefs are ~10-15KB.
    const capped = markdown.length > 60_000 ? markdown.slice(0, 60_000) : markdown

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Current stable Sonnet. The previous date-suffixed alias
        // (claude-sonnet-4-20250514) has been retired by Anthropic,
        // which surfaced as a 4xx from the upstream API and a non-2xx
        // back to the brand-guide editor when uploading strategy briefs.
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Here is the strategy brief markdown. Extract the brand voice prefill payload and return only JSON:\n\n${capped}`,
        }],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      throw new Error(`Anthropic API error ${anthropicRes.status}: ${errText.slice(0, 200)}`)
    }

    const anthropicData = await anthropicRes.json()
    const text = anthropicData.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')

    const payload = tryParseJson(text)
    if (!payload) {
      throw new Error('Could not parse JSON from Claude response')
    }

    return new Response(JSON.stringify({ prefill: normalize(payload) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch { /* fall through */ }
  // Pull the first balanced `{ ... }` block and parse that.
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

// Coerce anything odd back to the expected shape so the client doesn't have
// to defensively re-validate every field.
function normalize(raw: Record<string, unknown>): {
  voice_overview: string
  brand_statement: string
  tone_characteristics: Array<{ title: string; description: string }>
  voice_guidelines: Array<{ title: string; description: string }>
  brand_attributes: Array<{ label: string; description: string }>
} {
  const asString = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const asTitleDescArray = (v: unknown) =>
    Array.isArray(v)
      ? v.map(item => {
        const r = item as Record<string, unknown>
        return {
          title: asString(r.title),
          description: asString(r.description),
        }
      }).filter(x => x.title)
      : []
  const asLabelDescArray = (v: unknown) =>
    Array.isArray(v)
      ? v.map(item => {
        const r = item as Record<string, unknown>
        return {
          label: asString(r.label),
          description: asString(r.description),
        }
      }).filter(x => x.label)
      : []

  return {
    voice_overview: asString(raw.voice_overview),
    brand_statement: asString(raw.brand_statement),
    tone_characteristics: asTitleDescArray(raw.tone_characteristics),
    voice_guidelines: asTitleDescArray(raw.voice_guidelines),
    brand_attributes: asLabelDescArray(raw.brand_attributes),
  }
}
