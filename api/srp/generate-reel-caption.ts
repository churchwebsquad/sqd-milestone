/**
 * Vercel Serverless Function — /api/srp/generate-reel-caption
 *
 * Writes a short Instagram Reel caption for ONE sermon clip.
 *
 * Wire shape mirrors Sermon Studio App's generate-caption edge function
 * so the ported 12-step UI can call it without modification:
 *
 *   POST { quote, brandVoice?, accountContext?, userGuidance? }
 *   → 200 { caption, brandVoiceTags }
 *
 * Reliability: uses callGateway() which forces a single tool call with
 * strict JSON Schema. The "Model returned non-JSON output" failure
 * mode of the previous prose+prefill+JSON.parse approach cannot happen.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import {
  callGateway,
  resolvePrompt,
  BRAND_VOICE_TAGS_BLOCK,
  GatewayRateLimitError,
  GatewayTransientError,
} from './_lib/aiGateway.js'

export const maxDuration = 45

const DEFAULT_SYSTEM_PROMPT = `You are an Instagram copywriter for churches. Write short, punchy Reel captions.

STYLE RULES:
- Keep it SHORT. 1-3 sentences max before hashtags. Think Instagram-native.
- Avoid em dashes. Use periods, commas, or line breaks.
- Do NOT repeat the sermon quote verbatim. Capture the essence in your own words.
- Be relatable, warm, and conversational. Connect to everyday life.
- Vary your approach across captions:
  • A thought-provoking question
  • A call to action that inspires change
  • A practical takeaway
  • A short list of ways to live it out
- Use emojis sparingly (1-2 max).`

interface ReelCaptionArgs {
  caption: string
  brandVoiceTags: string[]
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const quote          = typeof req.body?.quote === 'string' ? req.body.quote : ''
  const brandVoice     = typeof req.body?.brandVoice === 'string' ? req.body.brandVoice : ''
  const accountContext = (req.body?.accountContext ?? {}) as Record<string, any>
  const userGuidance   = typeof req.body?.userGuidance === 'string' ? req.body.userGuidance : ''
  if (!quote) return res.status(400).json({ error: 'quote required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const ctxParts: string[] = []
  if (brandVoice)                       ctxParts.push(`Manually pasted brand voice guidelines: ${brandVoice}`)
  if (accountContext?.speakAs)          ctxParts.push(`Speak to the audience as: ${accountContext.speakAs}`)
  if (accountContext?.bibleTranslation) ctxParts.push(`When quoting scripture, use: ${accountContext.bibleTranslation}`)
  if (accountContext?.smsNotes)         ctxParts.push(`Important notes: ${accountContext.smsNotes}`)
  const ctx = ctxParts.join('\n')

  const basePrompt = (await resolvePrompt(sb, 'reel_caption')) ?? DEFAULT_SYSTEM_PROMPT
  const systemPrompt = [basePrompt, ctx, BRAND_VOICE_TAGS_BLOCK].filter(Boolean).join('\n\n')

  const userPrompt =
    `Write a short Instagram Reel caption for a sermon clip about this teaching moment:\n\n"${quote}"\n\n` +
    `Keep it to 1-3 punchy sentences that connect to real life. End with 3-5 hashtags.` +
    (userGuidance ? `\n\nAdditional guidance from the user: "${userGuidance}"` : '')

  try {
    const result = await callGateway<ReelCaptionArgs>({
      system: systemPrompt,
      user:   userPrompt,
      toolName: 'return_caption',
      toolDescription: 'Return the generated caption text and the brand voice tags that shaped it.',
      toolSchema: {
        type: 'object',
        properties: {
          caption: {
            type: 'string',
            description: 'The short Instagram Reel caption with hashtags.',
          },
          brandVoiceTags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short tags quoting the exact source phrases (Guidelines:, Speaks as:, Bible:, Notes:) that shaped the caption.',
          },
        },
        required: ['caption', 'brandVoiceTags'],
        additionalProperties: false,
      },
      maxTokens: 600,
    })
    return res.status(200).json({
      caption:        result.args.caption,
      brandVoiceTags: result.args.brandVoiceTags ?? [],
      usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
    })
  } catch (e) {
    if (e instanceof GatewayRateLimitError)  return res.status(429).json({ error: 'Rate limit exceeded. Please try again in a moment.' })
    if (e instanceof GatewayTransientError)  return res.status(502).json({ error: e.message })
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Caption generation failed' })
  }
}
