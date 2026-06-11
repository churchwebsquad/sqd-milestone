/**
 * Vercel Serverless Function — /api/srp/generate-sunday-invite
 *
 * Generates 3 Sunday service invite options in distinct tones:
 *   1. Warm & welcoming — generic, no sermon reference.
 *   2. Energetic & compelling — generic, no sermon reference.
 *   3. Topical — short tease tied to the upcoming sermon.
 *
 *   POST { transcript, brandVoice?, accountContext?, userGuidance? }
 *   → 200 { invites: [{ tone, text, citation, brandVoiceTags }, ...] }
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

const DEFAULT_SYSTEM_PROMPT = `You are a social media copywriter for churches. Write Sunday service invite posts that focus on inviting people to attend this upcoming Sunday's service. The primary goal is to make someone feel welcomed and excited to visit or return. Keep each invite to 2-4 sentences. Include placeholders [Church Name] and [Service Times] for the user to fill in. Avoid em dashes. Use periods, commas, or line breaks instead.`

const DEFAULT_USER_PROMPT = `Write 3 Sunday service invite posts with different tones:
1. A warm & welcoming generic invitation. Do NOT reference the sermon topic at all. Focus purely on community, belonging, and showing up.
2. An energetic & compelling generic invitation. Do NOT reference the sermon topic at all. Focus on excitement, energy, and what it feels like to be part of this church.
3. A topical invitation that briefly teases what will be discussed this Sunday based on the sermon context below. Keep the sermon reference to one short phrase, not a summary.

For each invite, provide a "citation" field. For options 1 and 2, use a short general quote from the transcript about community or faith. For option 3, use a verbatim quote related to the topic teaser.

Sermon context (for option 3 only):`

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    invites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tone:           { type: 'string', description: 'Short label for this option\'s tone (e.g. "warm", "energetic", "topical").' },
          text:           { type: 'string', description: 'The invite text. 2-4 sentences.' },
          citation:       { type: 'string', description: 'A short verbatim quote from the transcript that supports or inspired this invite.' },
          brandVoiceTags: { type: 'array', items: { type: 'string' }, description: 'Short tags quoting the exact source phrases (Guidelines:, Speaks as:, Bible:, Notes:).' },
        },
        required: ['tone', 'text', 'citation', 'brandVoiceTags'],
        additionalProperties: false,
      },
    },
  },
  required: ['invites'],
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

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const ctxParts: string[] = []
  if (brandVoice)                       ctxParts.push(`Manually pasted brand voice guidelines: ${brandVoice}`)
  if (accountContext?.speakAs)          ctxParts.push(`Speak to the audience as: ${accountContext.speakAs}`)
  if (accountContext?.churchName)       ctxParts.push(`Church name: ${accountContext.churchName}`)
  if (accountContext?.smsNotes)         ctxParts.push(`Important notes: ${accountContext.smsNotes}`)
  const ctx = ctxParts.join('\n')

  const [sysBase, userBase] = await Promise.all([
    resolvePrompt(sb, 'sunday_invite_system'),
    resolvePrompt(sb, 'sunday_invite_user'),
  ])

  const systemPrompt = [sysBase ?? DEFAULT_SYSTEM_PROMPT, ctx, BRAND_VOICE_TAGS_BLOCK].filter(Boolean).join('\n\n')
  const userPrompt =
    `${userBase ?? DEFAULT_USER_PROMPT}\n${transcript?.slice(0, 4000) || 'General church service'}` +
    (userGuidance ? `\n\nAdditional guidance from the user: "${userGuidance}"` : '')

  try {
    const result = await callGateway<{ invites: any[] }>({
      system: systemPrompt,
      user:   userPrompt,
      toolName: 'suggest_invites',
      toolDescription: 'Return 3 Sunday invite options with tone, text, citation, and brand voice tags.',
      toolSchema: TOOL_SCHEMA,
      maxTokens: 1500,
    })
    return res.status(200).json({
      invites: result.args.invites ?? [],
      usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
    })
  } catch (e) {
    if (e instanceof GatewayRateLimitError)  return res.status(429).json({ error: 'Rate limit exceeded.' })
    if (e instanceof GatewayTransientError)  return res.status(502).json({ error: e.message })
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Sunday invite generation failed' })
  }
}
