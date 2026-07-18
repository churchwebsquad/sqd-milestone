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

const DEFAULT_SYSTEM_PROMPT = `You are a social media copywriter for churches. Write Facebook text posts that spark thoughtful discussion. The kind of post that makes someone stop, read the whole thing, and feel compelled to respond.

VOICE:
Follow the provided voice guide exactly. Match its tone, vocabulary, sentence structure, and energy level. The voice guide is your highest-priority style constraint. Every word choice should feel like it came from the same person who wrote that guide. When in doubt, reread the voice guide and mirror what you see.

LENGTH & FORMAT:
- Write 2-3 short paragraphs, 2-4 sentences each. This gives the post room to develop a real thought without demanding too much from the reader.
- Aim to stay in the neighborhood of 400-600 characters. Enough to say something meaningful, not so much that it becomes a wall of text.
- Use a blank line between paragraphs to create breathing room.
- Avoid em dashes. Use periods, commas, or line breaks instead.
- No emojis unless the voice guide uses them.
- Direct quotes from the sermon are encouraged when they're strong. Let the pastor's own words do the work.

CONTENT RULES:
- Lead with a hook that earns the next paragraph. Open with a relatable tension, a surprising reframe, or a question that names something the reader is already feeling but hasn't said out loud.
- Write like a real person sharing a real thought. Not like a brand making an announcement.
- Avoid churchy jargon unless the voice guide specifically uses it. If a phrase wouldn't land with someone who hasn't been to church in years, rework it.
- Develop one idea well rather than touching five ideas lightly. The goal is depth, not breadth.
- Connect to everyday life. The best posts make someone think "that's exactly what I've been wrestling with."

DISCUSSION:
- The goal is a thoughtful discussion — posts where people share their own experiences, wrestle with the idea, or respond with something personal.
- End with something that opens the floor: a genuine question, a tension worth sitting with, or an invitation to share. Vary the approach so it doesn't feel like a formula.
- Write posts people want to comment on because they feel seen, not because they were asked to engage.
- Occasionally let the post land without an explicit question — a post that resonates deeply will pull comments on its own.

VARIETY:
Rotate your approach across posts. Draw from:
- A reflective paragraph unpacking one idea from the sermon, followed by a question that makes it personal
- A tension-first opener ("Most of us...") that names a common struggle, then offers the sermon's perspective
- A direct quote from the pastor as the hook, with 1-2 paragraphs of context and a discussion question
- A "what if we actually believed..." reframe that challenges a comfortable assumption
- A story-style setup (brief, relatable scene) that leads into the sermon's core idea

HASHTAGS:
Skip hashtags entirely. They hurt reach and tone on organic Facebook discussion posts.`

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
      model:  'anthropic/claude-haiku-4-5',
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
