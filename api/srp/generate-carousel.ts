/**
 * Vercel Serverless Function — /api/srp/generate-carousel
 *
 * Two modes, branched on body.type:
 *   1. (default) Generate 3 Instagram carousel concepts from a transcript.
 *      Each option has slides + citations + brandVoiceTags.
 *   2. type === "caption": Generate a short Instagram caption for an
 *      already-picked carousel (caller passes the slides[]).
 *
 *   POST { transcript, brandVoice?, accountContext?, type?, slides?, userGuidance? }
 *   → 200 { options }   (default mode)
 *   → 200 { caption, brandVoiceTags }   (caption mode)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import {
  callGateway,
  resolvePrompt,
  BRAND_VOICE_TAGS_BLOCK,
  GatewayRateLimitError,
  GatewayTransientError,
  type ToolSchema,
} from './_lib/aiGateway.js'

export const maxDuration = 60

const DEFAULT_SLIDES_PROMPT = `You are a social media content strategist for churches. Create Instagram carousel slide concepts from sermon content. Each carousel MUST follow one of the 3 layout structures exactly, including the correct number of slides. Do not add or remove slides from the layout. When quoting Bible verses, include the translation name (e.g. 'Romans 8:28 ESV'). Avoid em dashes.`

const DEFAULT_CAPTION_PROMPT = `You are a social media copywriter for churches. Write concise, Instagram-friendly carousel captions.

STYLE RULES:
- Keep captions short and punchy. 2-3 sentences max before hashtags.
- Avoid em dashes. Use periods, commas, or line breaks instead.
- Be relatable and warm, not preachy.
- Vary your approach: question, call to action, practical takeaway, or short list.`

const SLIDES_TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slides: {
            type: 'array',
            items: { type: 'string' },
            description: 'Slide text in order. Exactly 4 or 5 entries matching the chosen layout.',
          },
          citations: {
            type: 'array',
            items: { type: 'string' },
            description: 'All verbatim transcript quotes that inspired or were used in this carousel.',
          },
          brandVoiceTags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short tags quoting the exact source phrases (Guidelines:, Speaks as:, Bible:, Notes:).',
          },
        },
        required: ['slides', 'citations', 'brandVoiceTags'],
        additionalProperties: false,
      },
    },
  },
  required: ['options'],
  additionalProperties: false,
}

const CAPTION_TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    caption:        { type: 'string', description: 'The carousel caption with hashtags.' },
    brandVoiceTags: { type: 'array', items: { type: 'string' }, description: 'Short tags showing which brand voice phrases shaped the caption.' },
  },
  required: ['caption', 'brandVoiceTags'],
  additionalProperties: false,
}

const USER_LAYOUTS_BLOCK = `Layout 1:
* Slide 1: Title + Subtitle
* Slide 2: Bible verse (in preferred translation when available, labeled with translation name)
* Slide 3: 1 sentence heading + 2-3 sentence subtext
* Slide 4: 1 sentence heading + 2-3 sentence subtext
* Slide 5: Closing quote

OR Layout 2:
* Slide 1: Title + Subtitle
* Slide 2: room for 3-5 sentences
* Slide 3: room for 3-5 sentences
* Slide 4: room for 3-5 sentences
* Slide 5: Closing quote or reflective statement

OR Layout 3:
* Slide 1: Bible verse (preferred translation when available, labeled with translation name)
* Slide 2: 2-3 sentence reflection
* Slide 3: 2-3 sentence reflection
* Slide 4: 1 sentence statement + short supporting subtext`

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const transcript     = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const brandVoice     = typeof req.body?.brandVoice === 'string' ? req.body.brandVoice : ''
  const accountContext = (req.body?.accountContext ?? {}) as Record<string, any>
  const userGuidance   = typeof req.body?.userGuidance === 'string' ? req.body.userGuidance : ''
  const type           = req.body?.type === 'caption' ? 'caption' : 'slides'
  const slides         = Array.isArray(req.body?.slides) ? req.body.slides as string[] : []

  if (type === 'slides' && (!transcript || transcript.trim().length < 200)) {
    return res.status(400).json({ error: 'transcript required (min ~200 chars)' })
  }
  if (type === 'caption' && slides.length === 0) {
    return res.status(400).json({ error: 'slides required when type=caption' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const ctxParts: string[] = []
  if (brandVoice)                       ctxParts.push(`Manually pasted brand voice guidelines: ${brandVoice}`)
  if (accountContext?.speakAs)          ctxParts.push(`Speak to the audience as: ${accountContext.speakAs}`)
  if (accountContext?.bibleTranslation) ctxParts.push(`When quoting scripture, use: ${accountContext.bibleTranslation}`)
  if (accountContext?.smsNotes)         ctxParts.push(`Important notes: ${accountContext.smsNotes}`)
  const ctx = ctxParts.join('\n')

  // -------- Caption mode --------
  if (type === 'caption') {
    const basePrompt = (await resolvePrompt(sb, 'carousel_caption')) ?? DEFAULT_CAPTION_PROMPT
    const systemPrompt = [basePrompt, ctx, BRAND_VOICE_TAGS_BLOCK].filter(Boolean).join('\n\n')
    const userPrompt =
      `Write a short Instagram caption for a carousel post with these slides:\n\n${slides.join('\n')}\n\n` +
      `Keep it concise. End with 3-5 hashtags.` +
      (userGuidance ? `\n\nAdditional guidance from the user: "${userGuidance}"` : '')

    try {
      const result = await callGateway<{ caption: string; brandVoiceTags: string[] }>({
        system: systemPrompt,
        user:   userPrompt,
        toolName: 'return_caption',
        toolDescription: 'Return the carousel caption and the brand voice tags that shaped it.',
        toolSchema: CAPTION_TOOL_SCHEMA,
        maxTokens: 600,
      })
      return res.status(200).json({
        caption:        result.args.caption,
        brandVoiceTags: result.args.brandVoiceTags ?? [],
        usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
      })
    } catch (e) {
      if (e instanceof GatewayRateLimitError)  return res.status(429).json({ error: 'Rate limit exceeded.' })
      if (e instanceof GatewayTransientError)  return res.status(502).json({ error: e.message })
      return res.status(502).json({ error: e instanceof Error ? e.message : 'Caption generation failed' })
    }
  }

  // -------- Slides mode (default) --------
  const basePrompt = (await resolvePrompt(sb, 'carousel_slides')) ?? DEFAULT_SLIDES_PROMPT
  const systemPrompt = [basePrompt, ctx, BRAND_VOICE_TAGS_BLOCK].filter(Boolean).join('\n\n')

  const userPrompt =
    `Create 3 different Instagram carousel concepts from this sermon transcript. Please follow these layouts when possible.\n\n` +
    `${USER_LAYOUTS_BLOCK}\n\n` +
    `Please use direct quotes and bible verses used in the transcript.\n\n` +
    `For each concept, include a "citations" field listing ALL verbatim quotes from the transcript that the carousel draws from. Include every quote, Bible verse, or key phrase used or paraphrased in the slides.\n\n` +
    `Transcript:\n${transcript.slice(0, 30000)}` +
    (userGuidance ? `\n\nAdditional guidance from the user: "${userGuidance}"` : '')

  try {
    const result = await callGateway<{ options: any[] }>({
      system: systemPrompt,
      user:   userPrompt,
      toolName: 'suggest_carousels',
      toolDescription: 'Return 3 Instagram carousel options with slides[], citations[], and brand-voice tags.',
      toolSchema: SLIDES_TOOL_SCHEMA,
      maxTokens: 4000,
    })
    return res.status(200).json({
      options: result.args.options ?? [],
      usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
    })
  } catch (e) {
    if (e instanceof GatewayRateLimitError)  return res.status(429).json({ error: 'Rate limit exceeded.' })
    if (e instanceof GatewayTransientError)  return res.status(502).json({ error: e.message })
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Carousel generation failed' })
  }
}
