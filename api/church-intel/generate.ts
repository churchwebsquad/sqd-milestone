/**
 * Vercel Serverless Function — /api/church-intel/generate
 *
 * Generates or updates a Church Intelligence Profile via Anthropic API.
 * Anthropic key lives in Vercel env vars (server-side only, no VITE_ prefix).
 *
 * Required env var:
 *   ANTHROPIC_API_KEY
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    console.error('[church-intel] ANTHROPIC_API_KEY is not set')
    return res.status(500).json({ error: 'Anthropic API key not configured' })
  }

  try {
    const {
      mode,
      churchName,
      churchNumber,
      denomination,
      websiteUrl,
      instagram,
      facebook,
      youtube,
      twitter,
      linkedin,
      platforms,
      pastWork,
      focusNotes,
      homepageScreenshot,
      files,
      existingProfile,
      feedback,
      learned,
      scopes,
    } = req.body

    // Build the prompt
    const prompt = mode === 'update'
      ? buildUpdatePrompt({ churchName, websiteUrl, existingProfile, feedback, learned, scopes })
      : buildNewPrompt({ churchName, churchNumber, denomination, websiteUrl, instagram, facebook, youtube, twitter, linkedin, platforms, pastWork, focusNotes })

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

    console.log(`[church-intel] Generating ${mode} profile for ${churchName} (#${churchNumber})`)

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
      console.error(`[church-intel] Anthropic API error ${anthropicRes.status}:`, errText.slice(0, 300))
      return res.status(502).json({ error: `Anthropic API error ${anthropicRes.status}: ${errText.slice(0, 200)}` })
    }

    const anthropicData = await anthropicRes.json()
    const text = (anthropicData.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    // Parse JSON from response
    let profile = tryParseJson(text)

    // If parsing failed, try a cleanup pass
    if (!profile) {
      console.log('[church-intel] First parse failed, attempting cleanup pass')
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
      const cleanupText = (cleanupData.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
      profile = tryParseJson(cleanupText)
    }

    if (!profile) {
      return res.status(422).json({ error: 'Could not parse profile JSON from Claude response' })
    }

    console.log(`[church-intel] Successfully generated profile for ${churchName}`)
    return res.status(200).json({ profile })
  } catch (err: any) {
    console.error('[church-intel] Error:', err.message || err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

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
  instagram?: string; facebook?: string; youtube?: string; twitter?: string; linkedin?: string
  platforms?: string; pastWork?: string; focusNotes?: string
}): string {
  const { churchName, churchNumber, denomination, websiteUrl, instagram, facebook, youtube, twitter, linkedin, platforms, pastWork, focusNotes } = params
  return `You are a social media content strategist for a church media agency. Every week this agency produces a Sermon Recap Pack containing: (1) Sermon Recap Videos x2, (2) Carousel Post, (3) Photo Recap Post, (4) Sunday Invite Post, (5) Facebook Text Post.

Research this church thoroughly — website, social media, sermon content, about pages — and produce a Church Intelligence Profile. The brand voice section must be DETAILED and SPECIFIC.

Church: ${churchName}
${churchNumber ? 'Church number: ' + churchNumber : ''}
${denomination ? 'Denomination: ' + denomination : ''}
Website: ${websiteUrl}
${instagram ? 'Instagram: ' + instagram : ''}
${facebook ? 'Facebook: ' + facebook : ''}
${youtube ? 'YouTube: ' + youtube : ''}
${twitter ? 'Twitter/X: ' + twitter : ''}
${linkedin ? 'LinkedIn: ' + linkedin : ''}
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
