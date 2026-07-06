/**
 * Vercel Serverless Function — /api/srp/generate-sunday-invite
 *
 * Generates 2-4 Sunday invite posts across distinct angles.
 * "lookingAhead" (parsed from the ClickUp task) is the primary signal
 * for Post 4 — upcoming events, series launches, baptisms, etc.
 *
 *   POST { transcript?, brandVoice?, accountContext?, lookingAhead?, userGuidance?, keyInsights? }
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

const DEFAULT_SYSTEM_PROMPT = `You are a social media copywriter for churches. Write Sunday service invite posts that make someone feel genuinely welcomed and curious enough to actually show up this Sunday.

VOICE:
Follow the provided voice guide exactly. This is your highest-priority constraint. Read the voice guide carefully. Then write from inside it, not about it. The test: someone who goes to that church reads the post and thinks "yes, that sounds like us." Not "yes, that describes us."
Sounds right: "You don't have to pretend this week was fine." Sounds wrong: "We're a community that meets people where they are." The second sentence is describing a quality. The first one has it. Every post needs to pass that test. Match the vocabulary, sentence rhythm, and temperature of the voice guide precisely. Never default to generic church marketing tone.

THE CORE PROBLEM YOU'RE SOLVING:
Most Sunday invite posts sound identical every week: "Join us this Sunday! All are welcome! We can't wait to see you!" That's wallpaper. Your job is to make each invite feel like a specific reason to show up THIS Sunday. Every post needs a fresh angle.

WHAT TO WRITE:
Write 2-4 posts. Always write at least 2. Write more only when you have enough material to make each one genuinely distinct. Don't write a post just to fill a slot.

Post 1 — Community angle: Write for the person on the fence. Name something real about the hesitation and dissolve it. Focus on people and belonging, not program. Do not reference the sermon.

Post 2 — Momentum angle: Write for the person who needs a reason to show up this specific Sunday. Forward-leaning, confident, not hype-y. Do not reference the sermon.

Post 3 — Sermon tease (only write this if a transcript or sermon details are provided): Find the tension in the sermon. The question people are already carrying. Tease it in one phrase and open a loop. Do not summarize. The person should finish reading and think "I want to know how that ends."

Post 4 — What's coming (only write this if "Looking Ahead" context or a real upcoming event is provided that doesn't overlap with Posts 1-3): Build the invite around why being there THIS Sunday specifically matters. If nothing specific is provided, skip this post entirely rather than writing something generic.

RULES FOR ALL POSTS:
- 2-4 sentences plus the details block.
- Never open with "Join us this Sunday." Find a more interesting door in.
- No em dashes. Use periods, commas, or line breaks instead.
- No stacked welcome clichés. One genuine sentiment beats three generic ones.
- Don't use the word "energy." Find the specific thing you actually mean.
- No guilt, no pressure, no "you should be here" framing. Invitation, not obligation.
- Every post must feel clearly different from the others. If two could be swapped and no one would notice, rewrite one.
- Write for the person who's on the fence, not the person already coming.
- Use emojis only if the voice guide does.

SERMON TRANSCRIPT USE:
The transcript is source material, not a quote mine. Read it to understand what the pastor actually cares about, what tension the sermon lives in, what it would feel like to be in that room. Write from that understanding. You don't need to quote it directly.

WHEN EXTRA CONTEXT IS PROVIDED:
If a direction, theme, event detail, or specific request is included: use it specifically. Specific context always overrides your defaults.

DETAILS BLOCK:
Every single post must end with a details block on its own line. No exceptions. Use these exact placeholders even if real values haven't been provided:

[Church Name] [Service Times]
[Location/Address]
[Website or Link]

Do not remove, rename, skip, or substitute any of these placeholders. A human editor will fill them in.`

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    invites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tone:           { type: 'string', description: 'Short label for this post\'s angle (e.g. "Community", "Momentum", "Sermon tease", "What\'s coming").' },
          text:           { type: 'string', description: 'The invite post text including the details block at the end.' },
          citation:       { type: 'string', description: 'A short verbatim quote from the transcript that inspired this post, or empty string if no transcript was used.' },
          brandVoiceTags: { type: 'array', items: { type: 'string' }, description: 'Short tags quoting the exact source phrases (Guidelines:, Speaks as:, Bible:, Notes:) that shaped this post.' },
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
  const lookingAhead   = typeof req.body?.lookingAhead === 'string' ? req.body.lookingAhead : ''
  const keyInsights:   string[] = Array.isArray(req.body?.keyInsights) ? req.body.keyInsights : []

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const ctxParts: string[] = []
  if (brandVoice)                       ctxParts.push(`Manually pasted brand voice guidelines: ${brandVoice}`)
  if (accountContext?.speakAs)          ctxParts.push(`Speak to the audience as: ${accountContext.speakAs}`)
  if (accountContext?.churchName)       ctxParts.push(`Church name: ${accountContext.churchName}`)
  if (accountContext?.smsNotes)         ctxParts.push(`Important notes: ${accountContext.smsNotes}`)
  const ctx = ctxParts.join('\n')

  const basePrompt   = (await resolvePrompt(sb, 'sunday_invite_system')) ?? DEFAULT_SYSTEM_PROMPT
  const systemPrompt = [basePrompt, ctx, BRAND_VOICE_TAGS_BLOCK].filter(Boolean).join('\n\n')

  const lookingAheadSection = lookingAhead.trim()
    ? `\n\nLOOKING AHEAD — UPCOMING EVENTS & CONTEXT (use for Post 4 if relevant):\n${lookingAhead}`
    : ''

  const insightsSection = keyInsights.length
    ? `\n\nKEY INSIGHTS FROM THIS SERMON (use for Post 3 sermon tease):\n${keyInsights.map((ins, i) => `${i + 1}. ${ins}`).join('\n')}`
    : ''

  const userPrompt =
    `Write 2-4 Sunday invite posts following the angles in the system prompt.\n\n` +
    `Only write Post 3 if sermon details are provided below. Only write Post 4 if "Looking Ahead" context provides a real upcoming event.\n\n` +
    (transcript
      ? `Sermon transcript:\n${transcript.slice(0, 6000)}`
      : 'No transcript provided — write Posts 1 and 2 only.') +
    lookingAheadSection +
    insightsSection +
    (userGuidance ? `\n\nAdditional guidance: "${userGuidance}"` : '')

  try {
    const result = await callGateway<{ invites: any[] }>({
      system: systemPrompt,
      user:   userPrompt,
      toolName: 'suggest_invites',
      toolDescription: 'Return 2-4 Sunday invite posts with tone label, text (including details block), citation, and brand voice tags.',
      toolSchema: TOOL_SCHEMA,
      maxTokens: 2500,
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
