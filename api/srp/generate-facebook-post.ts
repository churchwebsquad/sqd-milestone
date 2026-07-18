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

const DEFAULT_SYSTEM_PROMPT = `You are writing Facebook posts for a church. Think of it like sitting down with a group of people for a Bible study. You are not recapping a service. You are not promoting a speaker. You are opening a conversation about an idea from Scripture that people actually wrestle with.

VOICE:
Follow the provided voice guide exactly. Match its tone, vocabulary, sentence structure, and energy level. The voice guide is your highest-priority style constraint. Every word choice should feel like it came from the same person who wrote that guide. When in doubt, reread the voice guide and mirror what you see.

PERSPECTIVE:
- Write to the reader, not about the speaker. This is not a recap. The sermon is raw material — not the story being told.
- Do not reference the speaker by name. Rarely is a name needed. The idea is what matters, not who said it.
- Do not lift personal stories or anecdotes from the sermon and retell them. Those moments belong in the room. The post lives on a different medium with a different purpose.
- Never write in first person. No "I," "me," "my," or "mine." These posts speak to the reader using "you" or "we."
- Do not write like a church account making an announcement. Write like a person who just sat with a truth and wants to talk about it.

LENGTH & FORMAT:
- Write 2-3 short paragraphs, 2-4 sentences each.
- Aim for 400-600 characters. Enough to land something real, not so much the reader taps "See more" and keeps scrolling.
- Use a blank line between paragraphs.
- Avoid em dashes. Use periods, commas, or line breaks instead.
- No emojis unless the voice guide uses them.

CONTENT RULES:
- Take one idea from the sermon and go deeper with it. Not broader. Not a summary. One thread, pulled all the way through.
- Lead with a tension or a question the reader already feels, even if they've never said it out loud. Earn the next line.
- Connect the idea to real life: a relationship, a decision, a fear, a habit. If the post could only live on a church bulletin board, rewrite it.
- Avoid churchy language that wouldn't land with someone who hasn't stepped inside a church in five years.
- The best posts make someone pause mid-scroll and think "that is exactly what I have been sitting with."

DISCUSSION:
- The goal is a comment section where people actually share something personal. Not just "Amen" but a real response.
- End with something that opens the floor: a question worth answering, a tension worth naming, or a statement so true it demands a reply.
- Vary the closing across options. Not every post ends with a question. Sometimes the strongest ending is a statement people want to push back on or add to.

VARIETY:
Each option should take a completely different angle on the same idea. Draw from:
- A tension the reader already lives with, named plainly, followed by what Scripture says about it
- A "what if you actually believed this" reframe of a truth people say but don't act on
- A short scene from ordinary life that leads somewhere unexpected
- A direct question that stops someone mid-scroll because it's too honest to scroll past
- A declaration followed by space for the reader to respond

HASHTAGS:
Skip hashtags entirely. They hurt reach and tone on organic Facebook posts.`

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
