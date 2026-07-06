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

const DEFAULT_SYSTEM_PROMPT = `You are a social media copywriter for churches. Write engaging Facebook text posts inspired by sermon content.

VOICE:
Follow the provided voice guide exactly. Match its tone, vocabulary, sentence structure, and energy level. The voice guide is your highest-priority style constraint. Every word choice should feel like it came from the same person who wrote that guide. When in doubt, reread the voice guide and mirror what you see.

LENGTH & FORMAT:
- Aim for 3-6 sentences. Long enough to develop a thought, short enough to display without "See more" on mobile (under ~480 characters is ideal).
- Avoid em dashes. Use periods, commas, or line breaks instead.
- Use line breaks between ideas to create breathing room. Dense paragraphs get scrolled past.
- No emojis unless the voice guide uses them. Facebook text posts tend to land better without them.
- Feel free to use direct quotes when it feels appropriate and was a particularly strong quote.

CONTENT RULES:
- Do NOT repeat the sermon quote verbatim. Translate the idea into your own words.
- Lead with a hook that earns the second sentence. Open with a relatable moment, a surprising reframe, or a question that makes someone pause mid-scroll.
- Write like a real person sharing a real thought. Not like a brand making an announcement.
- Avoid churchy jargon unless the voice guide specifically uses it. If a phrase wouldn't make sense to someone who's never been to church, rework it.
- Connect to everyday life. The best church posts make someone think "that's exactly what I needed to hear today."

ENGAGEMENT:
- End with something that invites response. A question, a "tag someone who," a fill-in-the-blank, or a simple prompt to share. But vary your approach so it doesn't feel formulaic.
- Write posts people want to comment on because they feel seen, not because you asked them to comment.
- Occasionally skip the explicit engagement prompt entirely. A post that just resonates deeply will generate comments on its own.

VARIETY:
Rotate your approach so the feed doesn't feel repetitive. Draw from:
- A personal-feeling reflection that unpacks one idea from the sermon
- A question that reframes a common struggle
- A "what if" scenario that challenges assumptions
- A short list of practical ways to apply the message this week
- A story-style post that paints a brief, relatable scene
- A bold, concise statement that stands on its own (2-3 sentences max)

HASHTAGS:
Skip hashtags entirely unless specifically requested. Organic Facebook text posts perform better without them.`

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
  const keyInsights:   string[] = Array.isArray(req.body?.keyInsights) ? req.body.keyInsights : []
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

  const insightsSection = keyInsights.length
    ? `\n\nKEY INSIGHTS FROM THIS SERVICE (use to add depth and choose the most resonant angles):\n${keyInsights.map((ins, i) => `${i + 1}. ${ins}`).join('\n')}`
    : ''

  const userPrompt =
    `Write exactly 4 Facebook text post options from this sermon transcript, one for each angle described in the system prompt.\n\n` +
    `For each post, provide a "citations" field listing ALL verbatim transcript quotes the post draws from.\n\n` +
    `Transcript:\n${transcript.slice(0, 30000)}` +
    insightsSection +
    (userGuidance ? `\n\nSPECIAL DIRECTION: "${userGuidance}"` : '')

  try {
    const result = await callGateway<{ posts: any[] }>({
      system: systemPrompt,
      user:   userPrompt,
      toolName: 'suggest_posts',
      toolDescription: 'Return 4 Facebook post options with text, citations, and brand voice tags.',
      toolSchema: TOOL_SCHEMA,
      maxTokens: 3500,
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
