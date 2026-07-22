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

Post 1 (Community angle): Write for the person on the fence. Name something real about the hesitation and dissolve it. Focus on people and belonging, not program. Do not reference the sermon.

Post 2 (Momentum angle): Write for the person who needs a reason to show up this specific Sunday. Forward-leaning, confident, not hype-y. Do not reference the sermon.

Post 3 (What's coming this Sunday, only write this if "Looking Ahead" context includes a real upcoming topic, series, event, or reason to show up): Build the invite around why being there THIS coming Sunday specifically matters. A series launch, a baptism Sunday, a guest speaker, a new topic. Open a loop — make them curious about what they'll miss if they don't come. If no specific upcoming context is provided, skip this post entirely.

Post 4 (Extra angle, only write if you have enough genuinely distinct material and it won't feel like a repeat of Posts 1-3): A completely different door in — a question, a human moment, an observation. If the previous posts already cover the range well, skip this one.

RULES FOR ALL POSTS:
- 2-4 sentences plus the details block.
- Never open with "Join us this Sunday." Find a more interesting door in.
- NEVER use em dashes (—). Hard rule. Use periods, commas, or line breaks instead.
- No stacked welcome clichés. One genuine sentiment beats three generic ones.
- Don't use the word "energy." Find the specific thing you actually mean.
- No guilt, no pressure, no "you should be here" framing. Invitation, not obligation.
- Every post must feel clearly different from the others. If two could be swapped and no one would notice, rewrite one.
- Write for the person who's on the fence, not the person already coming.
- Use emojis only if the voice guide does.

CRITICAL — THESE ARE INVITES FOR NEXT SUNDAY. NEVER REFERENCE THIS PAST SUNDAY'S TEACHING:
These posts go out to invite people to the COMING Sunday service. Next Sunday will be a completely different message, different text, different teaching. Never write anything like "last Sunday we talked about X," "this past weekend the message was Y," "continuing from Sunday's message," or any reference to what was taught. That's a different week entirely. These posts must stand completely on their own as invitations forward, not a recap of what people missed.

SERMON TRANSCRIPT USE:
The transcript is provided only to help you understand this church's culture, vocabulary, and spiritual temperature — not as content to reference. Read it to absorb their voice, what kinds of things they care about, how their pastor communicates. Do not reference the sermon, quote it, or tease it. These posts invite to next Sunday, not back to this Sunday.

WHEN EXTRA CONTEXT IS PROVIDED:
If a direction, theme, event detail, or specific request is included: use it specifically and completely. Specific context always overrides your defaults. Lean into exactly what is asked — do not dilute it with generic angles.

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

  const brandVoice       = typeof req.body?.brandVoice === 'string' ? req.body.brandVoice : ''
  const accountContext   = (req.body?.accountContext ?? {}) as Record<string, any>
  const userGuidance     = typeof req.body?.userGuidance === 'string' ? req.body.userGuidance : ''
  const lookingAhead     = typeof req.body?.lookingAhead === 'string' ? req.body.lookingAhead : ''
  const deliverableIntel = typeof req.body?.deliverableIntel === 'string' ? req.body.deliverableIntel.trim() : ''
  const keyInsights:     string[] = Array.isArray(req.body?.keyInsights) ? req.body.keyInsights : []

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
    ? `\n\nLOOKING AHEAD: UPCOMING EVENTS & CONTEXT (use for Post 4 if relevant):\n${lookingAhead}`
    : ''

  const insightsSection = keyInsights.length
    ? `\n\nCHURCH VOICE CONTEXT (themes this church cares about — use to inform tone, not to reference as past content):\n${keyInsights.map((ins, i) => `${i + 1}. ${ins}`).join('\n')}`
    : ''

  const guidanceBlock = userGuidance.trim()
    ? `\n\nDIRECTION FROM THE COACH — THIS OVERRIDES ALL OTHER DEFAULTS. Lean into exactly what is asked here. Build every post from this direction. Do not soften it or dilute it with generic angles:\n"${userGuidance}"\n`
    : ''

  const userPrompt =
    `Write 2-4 Sunday invite posts for NEXT Sunday's service. Do not reference what was taught this past Sunday.\n\n` +
    guidanceBlock +
    (deliverableIntel ? `\nChurch-specific guidance for this deliverable:\n${deliverableIntel}\n\n` : '') +
    lookingAheadSection +
    insightsSection

  try {
    const result = await callGateway<{ invites: any[] }>({
      model:  'anthropic/claude-haiku-4-5',
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
