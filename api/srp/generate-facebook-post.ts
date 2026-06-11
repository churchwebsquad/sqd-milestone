/**
 * Vercel Serverless Function — /api/srp/generate-facebook-post
 *
 * Generates 3 Facebook text post options inspired by a sermon transcript.
 * Each option carries citations (verbatim transcript quotes) and brand
 * voice tags.
 *
 *   POST { transcript, brandVoice?, accountContext?, userGuidance? }
 *   → 200 { posts: [{ text, citations, brandVoiceTags }, ...] }
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

const DEFAULT_SYSTEM_PROMPT = `You are a social media copywriter for churches. Write engaging Facebook text posts inspired by sermon content. Posts should feel authentic, conversational, and encourage engagement. Avoid em dashes. Use periods, commas, or line breaks instead.`

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text:           { type: 'string', description: 'The Facebook post text. 3-6 sentences.' },
          citations:      { type: 'array', items: { type: 'string' }, description: 'All verbatim transcript quotes that inspired or were used in this post.' },
          brandVoiceTags: { type: 'array', items: { type: 'string' }, description: 'Short tags quoting the exact source phrases (Guidelines:, Speaks as:, Bible:, Notes:).' },
        },
        required: ['text', 'citations', 'brandVoiceTags'],
        additionalProperties: false,
      },
    },
  },
  required: ['posts'],
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
  if (!transcript || transcript.trim().length < 200) {
    return res.status(400).json({ error: 'transcript required (min ~200 chars)' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const ctxParts: string[] = []
  if (brandVoice)                       ctxParts.push(`Manually pasted brand voice guidelines: ${brandVoice}`)
  if (accountContext?.speakAs)          ctxParts.push(`Speak to the audience as: ${accountContext.speakAs}`)
  if (accountContext?.bibleTranslation) ctxParts.push(`When quoting scripture, use: ${accountContext.bibleTranslation}`)
  if (accountContext?.smsNotes)         ctxParts.push(`Important notes: ${accountContext.smsNotes}`)
  const ctx = ctxParts.join('\n')

  const basePrompt = (await resolvePrompt(sb, 'facebook_post')) ?? DEFAULT_SYSTEM_PROMPT
  const systemPrompt = [basePrompt, ctx, BRAND_VOICE_TAGS_BLOCK].filter(Boolean).join('\n\n')

  const userPrompt =
    `Write 3 different Facebook text post options inspired by this sermon transcript. ` +
    `Each should be 3-6 sentences. Feel free to use direct quotes from the transcript.\n\n` +
    `For each post, also provide a "citations" field listing ALL verbatim quotes from the transcript that the post draws from. Include every quote, Bible verse, or key phrase used or paraphrased in the post.\n\n` +
    `Transcript:\n${transcript.slice(0, 30000)}` +
    (userGuidance ? `\n\nAdditional guidance from the user: "${userGuidance}"` : '')

  try {
    const result = await callGateway<{ posts: any[] }>({
      system: systemPrompt,
      user:   userPrompt,
      toolName: 'suggest_posts',
      toolDescription: 'Return 3 Facebook post options with text, citations, and brand voice tags.',
      toolSchema: TOOL_SCHEMA,
      maxTokens: 2500,
    })
    return res.status(200).json({
      posts: result.args.posts ?? [],
      usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
    })
  } catch (e) {
    if (e instanceof GatewayRateLimitError)  return res.status(429).json({ error: 'Rate limit exceeded.' })
    if (e instanceof GatewayTransientError)  return res.status(502).json({ error: e.message })
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Facebook post generation failed' })
  }
}
