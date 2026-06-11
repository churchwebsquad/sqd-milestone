/**
 * Vercel Serverless Function — /api/srp/generate-photo-recap
 *
 * Generates 3-5 photo recap caption options for a Sunday service
 * photo carousel. The system prompt branches on `category`:
 *
 *   - serviceHighlights   — baptisms, worship, child dedications, etc.
 *   - weekendTeaching     — recap of the sermon's key points
 *   - seriesStartEnd      — kicking off or wrapping a sermon series
 *   - generalCelebration  — generic Sunday vibe (default)
 *
 *   POST { transcript?, brandVoice?, accountContext?, category?, userGuidance? }
 *   → 200 { captions: [{ text, brandVoiceTags? }, ...] }
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

export const maxDuration = 45

const CATEGORY_DEFAULTS: Record<string, string> = {
  serviceHighlights: `You are a social media manager for a church, tasked with writing engaging captions for a photo carousel that recaps the weekend services. Focus on creating a warm, celebratory tone that reflects the spiritual impact and sense of community. Keep the captions concise, conversational, and uplifting. Include a call to action that encourages interaction (like tagging friends or sharing thoughts). Use relevant emojis and a branded hashtag.

Use the provided sermon transcript or submission details to identify event highlights (baptisms, worship moments, child dedications, etc.), spiritual impact (joy, faith, renewal), community feel (gratitude and connection), and craft 3-5 caption options with a call to action encouraging comments, tagging, or participation.`,

  weekendTeaching: `You are a social media manager for a church, tasked with writing an engaging caption for a photo carousel that features the congregation and highlights from the weekend's service. The tone should be thoughtful, faith-centered, inviting, and include a short recap of the weekend's message. The goal is to reflect on the key points from the sermon, create a sense of connection, and encourage people to engage in the comments or attend the next service. Keep it conversational and inspiring, using a mix of direct reflection and a call to action.

Use the provided sermon transcript to identify the core message, emotional impact, and next steps. Craft 3-5 caption options that summarize key points and encourage engagement or attendance.`,

  seriesStartEnd: `You are a social media manager for a church, tasked with writing an engaging caption for a photo carousel that highlights the experience of the weekend service as the beginning or end of a sermon series. Focus on creating a tone that feels personal, authentic, and connected to the reader. Mention practical or relatable details that help the reader see themselves in the moment (e.g., conversations in the lobby, meaningful worship moments, or how people responded). Keep the language simple, direct, and warm — like you're talking to a friend. Include a clear but gentle call to action.

Use the provided sermon transcript to identify the series title, atmosphere, personal moments, and next steps. Craft 3-5 caption options that feel authentic and inviting.`,

  generalCelebration: `You are a social media manager for a church, tasked with writing an engaging caption for a photo carousel that reflects on and celebrates the Sunday service experience. Since this is a general post, focus on capturing the overall atmosphere and emotional tone of the service — connection, worship, and community. Keep the tone warm, conversational, and faith-centered, as if you're talking to a friend. The goal is to create a sense of belonging and invite engagement through reflection or a call to action.

Use any available sermon transcript context to craft 3-5 caption options that celebrate the service atmosphere, community, and spiritual tone. Encourage sharing, commenting, or attending next week.`,
}

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    captions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text:           { type: 'string', description: 'The photo recap caption text.' },
          brandVoiceTags: { type: 'array', items: { type: 'string' }, description: 'Short tags quoting the exact source phrases (Guidelines:, Speaks as:, Bible:, Notes:).' },
        },
        required: ['text', 'brandVoiceTags'],
        additionalProperties: false,
      },
    },
  },
  required: ['captions'],
  additionalProperties: false,
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const transcript     = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const brandVoice     = typeof req.body?.brandVoice === 'string' ? req.body.brandVoice : ''
  const accountContext = (req.body?.accountContext ?? {}) as Record<string, any>
  const userGuidance   = typeof req.body?.userGuidance === 'string' ? req.body.userGuidance : ''
  const catKey         = (typeof req.body?.category === 'string' && req.body.category in CATEGORY_DEFAULTS)
    ? (req.body.category as keyof typeof CATEGORY_DEFAULTS)
    : 'generalCelebration'

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const promptKey   = `photo_recap_${catKey}`
  const fallback    = CATEGORY_DEFAULTS[catKey]
  const basePrompt  = (await resolvePrompt(sb, promptKey)) ?? fallback

  const ctxParts: string[] = []
  if (brandVoice)                       ctxParts.push(`Manually pasted brand voice guidelines:\n${brandVoice}`)
  if (accountContext?.speakAs)          ctxParts.push(`Speak to audience as: ${accountContext.speakAs}`)
  if (accountContext?.bibleTranslation) ctxParts.push(`Preferred Bible Translation: ${accountContext.bibleTranslation}`)
  if (accountContext?.churchName)       ctxParts.push(`Church Name: ${accountContext.churchName}`)
  if (accountContext?.smsNotes)         ctxParts.push(`Important notes: ${accountContext.smsNotes}`)
  const ctx = ctxParts.join('\n')

  const systemPrompt = [basePrompt, ctx, BRAND_VOICE_TAGS_BLOCK].filter(Boolean).join('\n\n')

  const userPrompt =
    `Here is the sermon transcript / submission context:\n\n` +
    (transcript || 'No transcript provided — write general captions for a weekend service photo recap.') +
    (userGuidance ? `\n\nAdditional guidance from the user: "${userGuidance}"` : '')

  try {
    const result = await callGateway<{ captions: any[] }>({
      system: systemPrompt,
      user:   userPrompt.slice(0, 30000),
      toolName: 'return_captions',
      toolDescription: 'Return 3-5 photo recap caption options with brand voice tags.',
      toolSchema: TOOL_SCHEMA,
      maxTokens: 2500,
    })
    return res.status(200).json({
      captions: result.args.captions ?? [],
      usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
    })
  } catch (e) {
    if (e instanceof GatewayRateLimitError)  return res.status(429).json({ error: 'Rate limit exceeded.' })
    if (e instanceof GatewayTransientError)  return res.status(502).json({ error: e.message })
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Photo recap generation failed' })
  }
}
