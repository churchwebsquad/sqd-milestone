// church-intel-generate — Supabase Edge Function
// Generates or updates a Church Intelligence Profile via Anthropic API.
// Anthropic key lives in Supabase secrets, never in the browser.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

    const body = await req.json()
    const {
      mode,           // 'new' | 'update'
      churchName,
      churchNumber,
      denomination,
      websiteUrl,
      instagram,
      facebook,
      youtube,
      platforms,
      pastWork,
      focusNotes,
      homepageScreenshot, // { mediaType, base64 } | null
      files,              // Array<{ mediaType, base64, isPdf }> | []
      // Update-specific fields
      existingProfile,    // ChurchIntelProfile JSON | null
      feedback,           // string | null
      learned,            // string | null
      scopes,             // string[] | null (e.g. ['tone', 'performance'])
    } = body

    // Build the prompt based on mode
    const prompt = mode === 'update'
      ? buildUpdatePrompt({ churchName, websiteUrl, existingProfile, feedback, learned, scopes })
      : buildNewPrompt({ churchName, churchNumber, denomination, websiteUrl, instagram, facebook, youtube, platforms, pastWork, focusNotes })

    // Build content blocks
    const contentBlocks: unknown[] = []

    // Homepage screenshot first (for color detection)
    if (homepageScreenshot?.base64) {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: homepageScreenshot.mediaType, data: homepageScreenshot.base64 },
      })
      contentBlocks.push({
        type: 'text',
        text: "The image above is a screenshot of this church's homepage. Use it to identify their exact primary brand colors and visual style. Extract the hex color values you can observe directly from this image.",
      })
    }

    // Additional files
    if (files?.length) {
      for (const f of files) {
        if (f.isPdf) {
          contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } })
        } else {
          contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.base64 } })
        }
      }
      contentBlocks.push({ type: 'text', text: 'The files above are past work examples or brand guides. Use them to inform the design, tone, and style sections.' })
    }

    contentBlocks.push({ type: 'text', text: prompt })

    // Call Anthropic
    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: 'You are a church social media research assistant. You MUST respond with ONLY a valid JSON object — no introduction, no explanation, no markdown, no text before or after the JSON. Your entire response must start with { and end with }. Be concise: keep every string value under 150 characters except brand_voice fields which can be up to 400 chars. Use the web_search tool to research the church first, then output the JSON.',
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: contentBlocks }],
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

    // Parse JSON from response
    let profile = tryParseJson(text)

    // If parsing failed, try a cleanup pass
    if (!profile) {
      const cleanupRes = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: 'You output only valid JSON. No prose, no markdown, no explanation. Your entire response must be a single JSON object starting with { and ending with }.',
          messages: [{ role: 'user', content: `Convert this into the required JSON format. Extract all the church profile information and output it as a single valid JSON object:\n\n${text}` }],
        }),
      })
      const cleanupData = await cleanupRes.json()
      const cleanupText = cleanupData.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('')
      profile = tryParseJson(cleanupText)
    }

    if (!profile) {
      throw new Error('Could not parse profile JSON from Claude response')
    }

    return new Response(JSON.stringify({ profile }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function tryParseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch {}
  }
  return null
}

function buildNewPrompt(params: {
  churchName: string; churchNumber?: string; denomination?: string; websiteUrl: string
  instagram?: string; facebook?: string; youtube?: string; platforms?: string
  pastWork?: string; focusNotes?: string
}): string {
  const { churchName, churchNumber, denomination, websiteUrl, instagram, facebook, youtube, platforms, pastWork, focusNotes } = params
  return `You are a social media content strategist for a church media agency. Every week this agency produces a Sermon Recap Pack containing: (1) Sermon Recap Videos x2, (2) Carousel Post, (3) Photo Recap Post, (4) Sunday Invite Post, (5) Facebook Text Post.

Research this church thoroughly — website, social media, sermon content, about pages — and produce a Church Intelligence Profile. The brand voice section must be DETAILED and SPECIFIC.

Church: ${churchName}
${churchNumber ? 'Church number: ' + churchNumber : ''}
${denomination ? 'Denomination: ' + denomination : ''}
Website: ${websiteUrl}
${instagram ? 'Instagram: ' + instagram : ''}
${facebook ? 'Facebook: ' + facebook : ''}
${youtube ? 'YouTube: ' + youtube : ''}
${platforms ? 'Platforms: ' + platforms : ''}
${pastWork ? 'Past work: ' + pastWork : ''}
${focusNotes ? 'Focus notes: ' + focusNotes : ''}

Return ONLY valid JSON matching the ChurchIntelProfile schema: church_name, church_number, website, tagline_or_mission, pastor_name, denomination, audience{primary,secondary,content_implication}, campus_locations, brand_voice{tone_summary,attributes[{name,description,write_with_this_in_mind}],vocabulary[],avoid[]}, design{primary_colors,accent_colors,visual_style,adobe_fonts[]}, sermon_recap_videos{clip_selection_guidance,caption_style,cta{consistent,pattern,observed_examples[]},music_preference,cover_frame,hook_approach,worship_reels{recommendation,reasoning}}, carousel_post{tone,slide_structure,design_notes,cta}, photo_recap_post{caption_tone,caption_example,what_to_highlight,cta}, sunday_invite_post{tone,caption_pattern,caption_example,cta}, caption_cta_patterns{observed_pattern,examples[],recommendation}, facebook_text_post{style,engagement_approach,example,cta}, what_performs_well{summary,themes[],avoid_content}, upcoming_opportunities, week1_tip`
}

function buildUpdatePrompt(params: {
  churchName: string; websiteUrl?: string; existingProfile?: unknown
  feedback?: string; learned?: string; scopes?: string[]
}): string {
  const { churchName, websiteUrl, existingProfile, feedback, learned, scopes } = params
  const fullRefresh = scopes?.includes('full')
  return `You are updating an existing Church Intelligence Profile based on new feedback and learnings.

Church: ${churchName}
Website: ${websiteUrl || ''}

EXISTING PROFILE:
${existingProfile ? JSON.stringify(existingProfile) : '(not available)'}

FEEDBACK FROM CHURCH: ${feedback || '(none)'}
WHAT THE TEAM LEARNED: ${learned || '(none)'}
SECTIONS TO REFRESH: ${fullRefresh ? 'Everything — full regeneration' : (scopes || []).join(', ')}

${fullRefresh ? 'Regenerate the entire profile incorporating all feedback.' : 'Keep all other sections exactly as-is. Only update: ' + (scopes || []).join(', ')}

Return the COMPLETE updated profile as ONLY valid JSON matching the ChurchIntelProfile schema.`
}
