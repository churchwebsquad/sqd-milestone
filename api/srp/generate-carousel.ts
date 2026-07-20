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

const DEFAULT_SLIDES_PROMPT = `You are a social media content strategist for churches. Create Instagram carousel slide concepts from sermon content. Generate one carousel for each of the 4 layout structures below. All four must be based on the same sermon content but each should pull from different angles, quotes, or themes within the sermon so they don't feel repetitive.

VOICE:
Follow the provided voice guide exactly. This is your highest-priority style constraint. Match its tone, vocabulary, sentence structure, and energy level precisely. Do not default to a generic "church marketing" tone. Every slide should sound like it was written by the same person who wrote the voice guide. The tone assigned to each layout (below) should work within the voice guide, not override it. Think of the tone as a dial within the voice, not a replacement for it.

GENERAL RULES:
- Every carousel MUST follow its layout structure exactly. Do not add, remove, or rearrange slides. Pay close attention to the slide count for each layout. They are not all the same. Layout 1: 4 slides. Layout 2: 5 slides. Layout 3: 4 slides. Layout 4: 3 slides. Layout 5: 1 slide.
- NEVER use em dashes (—). Hard rule. Use periods, commas, or line breaks instead.
- Use emojis only if the voice guide does.
- When quoting Bible verses, always include the translation name (e.g. "Romans 8:28 ESV").
- Do not use the word "energy." Find a more specific, concrete way to describe the feeling you mean.
- Never write in first person. Do not use "I," "me," "my," or "mine" anywhere in any slide. This applies to both original copy and selected sermon quotes. If a sermon quote uses first person, either skip it and choose a different quote, or rephrase it into second person ("you") or a universal statement.
- Write for Instagram. Every slide should be scannable in 2-3 seconds. No dense paragraphs.
- Each slide should be able to stand on its own visually while also building a narrative across the carousel. Someone swiping should feel pulled forward.
- All four carousels must draw from different parts of the sermon. Do not reuse the same quote, verse, or core idea across multiple layouts.

THE HOOK: THIS IS CRITICAL
Slide 1 of every carousel is the only slide people see before deciding to swipe or keep scrolling. It carries the entire carousel. If the hook doesn't stop someone mid-scroll and create an itch to swipe, nothing else matters.
- The hook must create a gap: a question unanswered, a tension unresolved, a statement that demands context. The reader should feel like they're missing something if they don't swipe.
- Avoid generic openers like "Let's talk about faith" or "Here's what God wants you to know."
- Strong hooks: a bold claim people might disagree with, a question that names a private struggle, a surprising reframe of a familiar idea, a short punchy statement that feels incomplete on purpose.
- Test your hook by asking: "Would I stop scrolling for this?" If the answer isn't an immediate yes, rewrite it.

CONTENT RULES:
- Do not just summarize the sermon. Translate the ideas into content that works on Instagram BUT don't make up your own content. Stick to the source material as close as possible. Using direct quotes from the sermon is not only okay but STRONGLY encouraged.
- The last slide should land with weight. A strong closing thought, a challenge, or a question that lingers. Not a throwaway.
- Vary the emotional arc across slides. Don't start intense and stay intense. Build, breathe, land.
- Keep bulleted or checklist items concrete and actionable. "Pray more" is vague. "Set a 5-minute alarm to pray before lunch" is specific.

Layout 1: Reflective Narrative (4 slides)
Tone: Conversational and personal. Like someone sharing a real thought out loud. Honest, relatable, grounded. Personal in feel, but written in second person. Talk to the reader, not about yourself. Must NOT deviate from the transcript. Use direct quotes and stick to the source material.
Slide 1: 1 sentence hook with 1-3 supporting sentences. Open with a relatable question, tension, or observation that makes someone think "okay, I need to hear the rest of this."
Slide 2: 2-3 sentences. Develop the thought. Build on the tension or question from slide 1. Go deeper, not wider.
Slide 3: 2-3 sentences. Shift toward insight or application. What does this look like in real life? Make it tangible.
Slide 4: 2-3 sentences. Close with a landing thought, challenge, call to action, or bible verse.

Layout 2: Title + Verse + List + Reflection + Close (5 slides)
Tone: Instructional. Clear, helpful, grounded. Like a wise friend breaking something down into steps you can actually follow. Not preachy. Not textbook. Just practical and warm.
Slide 1: A 4-5 word title. Bold, curiosity-driven, scroll-stopping hook. Must create an itch to swipe.
Slide 2: A Bible verse with translation. Choose a verse that directly supports the title and sets up what's coming. Let the verse breathe on its own without added commentary.
Slide 3: A bulleted list or checklist with a title. 3-5 items max. Each item should be a concrete, practical takeaway someone can act on. Not abstract concepts.
Slide 4: 2-3 sentences. Expand on the list with a brief reflection, using a direct quote if possible. Connect the practical steps to the bigger picture.
Slide 5: A closing sentence. One strong thought that ties it all together. Leave the reader with something that sticks.

Layout 3: Verse + Reflection + Close (4 slides)
Tone: Poetic. Beautiful, deliberate, unhurried. Let the words breathe. Sentences should feel crafted, not casual.
Slide 1: A Bible verse with translation. This is your hook. Must have been used in the sermon. Choose something striking enough to stop the scroll on its own without any setup.
Slide 2: 2-3 sentences. Begin unpacking the verse. Connect it to a feeling or experience the reader knows well. Don't explain the verse academically. Make it personal.
Slide 3: 2-3 sentences. Go deeper. Challenge the reader gently or reframe the verse in a way they haven't considered.
Slide 4: A closing statement. Brief, memorable, and final. A sentence someone might screenshot.

Layout 4: Bold Quotes (3 slides)
Tone: Strong and straightforward. Clean, confident, no filler. Let the quotes hit without over-explaining them.
Slide 1: A sermon quote or bold statement that stops the scroll. Choose something surprising, challenging, or deeply resonant. Must make someone stop and swipe.
Slide 2: NOT a quote. 1-3 sentences that build on the thought from slide 1.
Slide 3: A final quote, challenge, or statement that leaves something ringing in the reader's mind. The kind of slide people screenshot and send to a friend.
Always attribute sermon quotes clearly (e.g. "- Pastor [Name]") or weave attribution naturally into the framing. Every quote selected must speak to the reader or make a universal statement. No personal anecdotes or stories from the speaker's life.

Layout 5: Single Image with Text (1 slide)
This is not a carousel. It is one standalone graphic, a single slide designed to stop the scroll on its own. No setup, no swipe needed. It lives or dies by what's on that one frame.
Use a direct quote from the sermon: something the pastor actually said that is surprising, challenging, or deeply resonant. A line that feels like a firm hand on the shoulder. Do NOT use a Bible verse here; the quote must come from the pastor's own words.
The text must be short enough to read in 2 seconds. If it needs explanation, it's the wrong choice.
Attribute the quote clearly (e.g. "- Pastor [Name]").`

const DEFAULT_CAPTION_PROMPT = `You are a social media copywriter for churches. Write concise, Instagram-friendly captions to accompany carousel posts.

VOICE:
Follow the provided voice guide exactly. This is your highest-priority style constraint. Match its tone, vocabulary, sentence structure, and energy level precisely. Do not default to a generic "church marketing" tone. The caption should sound like it was written by the same person who wrote the voice guide.

PURPOSE:
The caption supports the carousel, it doesn't repeat it. Someone who reads the carousel slides and then reads the caption should get something new: a different angle, a deeper nudge, or a reason to engage. If the caption just restates what the slides already said, it's wasted space.

LENGTH & FORMAT:
- 2-3 sentences max before hashtags.
- NEVER use em dashes (—). Hard rule. Use periods, commas, or line breaks instead.
- Use emojis only if the voice guide does.
- Front-load the hook. The first line shows above the fold. If it doesn't earn the "more" tap, the rest doesn't matter.
- Never write in first person. No "I," "me," "my," or "mine." Speak to the reader.
- Do not use the word "energy."

CONTENT RULES:
- Be relatable and warm, not preachy. Write like a person, not a pulpit.
- Do not summarize the carousel content. The reader just swiped through it. Instead, do one of the following: ask a question that makes the carousel's message personal, give a practical next step the slides didn't cover, name the tension or feeling the carousel taps into, or invite a specific action (save, share, tag someone, comment).
- Avoid churchy jargon unless the voice guide specifically uses it.
- Write for the person scrolling alone at 11pm, not the person sitting in the front row on Sunday.

VARIETY:
Rotate your approach so captions don't feel formulaic. Draw from:
- A thought-provoking question that makes the reader pause
- A call to action tied to the carousel's theme (not generic "share this!")
- A practical takeaway or challenge for the week
- A "real talk" sentence that names what the reader might be feeling
- A bold, short statement that reframes the carousel's idea in one line

ENGAGEMENT PROMPTS:
End with something that invites a response, but vary the format. Options: a question, a "tag someone who," a fill-in-the-blank, a "save this for," a "drop a [emoji] if," or simply a statement strong enough that people comment on their own. Occasionally skip the engagement prompt entirely.

HASHTAGS:
- 3-5 relevant hashtags max.
- Mix broad reach tags with niche or sermon-specific tags.
- Place hashtags on a separate line after the caption.`

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


export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const transcript       = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const brandVoice       = typeof req.body?.brandVoice === 'string' ? req.body.brandVoice : ''
  const accountContext   = (req.body?.accountContext ?? {}) as Record<string, any>
  const userGuidance     = typeof req.body?.userGuidance === 'string' ? req.body.userGuidance : ''
  const deliverableIntel = typeof req.body?.deliverableIntel === 'string' ? req.body.deliverableIntel.trim() : ''
  const rawType          = req.body?.type
  const type             = rawType === 'caption' ? 'caption' : rawType === 'refine' ? 'refine' : 'slides'
  const slides           = Array.isArray(req.body?.slides) ? req.body.slides as string[] : []
  const keyInsights:     string[] = Array.isArray(req.body?.keyInsights) ? req.body.keyInsights : []

  if (type === 'slides' && (!transcript || transcript.trim().length < 200)) {
    return res.status(400).json({ error: 'transcript required (min ~200 chars)' })
  }
  if (type === 'caption' && slides.length === 0) {
    return res.status(400).json({ error: 'slides required when type=caption' })
  }
  if (type === 'refine' && slides.length === 0) {
    return res.status(400).json({ error: 'slides required when type=refine' })
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
        model:    'anthropic/claude-sonnet-4-6',
        system:   systemPrompt,
        user:     userPrompt,
        toolName: 'return_caption',
        toolDescription: 'Return the carousel caption and the brand voice tags that shaped it.',
        toolSchema: CAPTION_TOOL_SCHEMA,
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

  // -------- Refine mode --------
  if (type === 'refine') {
    const basePrompt = (await resolvePrompt(sb, 'carousel_slides')) ?? DEFAULT_SLIDES_PROMPT
    const systemPrompt = [basePrompt, ctx, BRAND_VOICE_TAGS_BLOCK].filter(Boolean).join('\n\n')
    const userPrompt =
      `You have a set of Instagram carousel slides that need to be refined based on coach feedback.\n\n` +
      `CURRENT SLIDES:\n${slides.map((s, i) => `Slide ${i + 1}: ${s}`).join('\n')}\n\n` +
      `COACH INSTRUCTION: "${userGuidance}"\n\n` +
      `Apply the instruction faithfully. You may reorder, split, merge, add, or remove slides as instructed. ` +
      `Return only the revised slides. No explanation needed. ` +
      `Keep the voice and style of the current slides unless the instruction says otherwise.` +
      (transcript ? `\n\nOriginal transcript (for pulling new quotes if needed):\n${transcript.slice(0, 20000)}` : '')

    const REFINE_SCHEMA: ToolSchema = {
      type: 'object',
      properties: {
        slides:         { type: 'array', items: { type: 'string' }, description: 'The revised slide texts in order.' },
        citations:      { type: 'array', items: { type: 'string' }, description: 'Verbatim transcript quotes used.' },
        brandVoiceTags: { type: 'array', items: { type: 'string' }, description: 'Brand voice tags.' },
      },
      required: ['slides', 'citations', 'brandVoiceTags'],
      additionalProperties: false,
    }

    try {
      const result = await callGateway<{ slides: string[]; citations: string[]; brandVoiceTags: string[] }>({
        model:    'anthropic/claude-sonnet-4-6',
        system:   systemPrompt,
        user:     userPrompt,
        toolName: 'return_refined_slides',
        toolDescription: 'Return the refined carousel slides after applying the coach instruction.',
        toolSchema: REFINE_SCHEMA,
        maxTokens: 2000,
      })
      return res.status(200).json({
        slides:         result.args.slides ?? [],
        citations:      result.args.citations ?? [],
        brandVoiceTags: result.args.brandVoiceTags ?? [],
        usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
      })
    } catch (e) {
      if (e instanceof GatewayRateLimitError)  return res.status(429).json({ error: 'Rate limit exceeded.' })
      if (e instanceof GatewayTransientError)  return res.status(502).json({ error: e.message })
      return res.status(502).json({ error: e instanceof Error ? e.message : 'Refine failed' })
    }
  }

  // -------- Slides mode (default) --------
  const basePrompt = (await resolvePrompt(sb, 'carousel_slides')) ?? DEFAULT_SLIDES_PROMPT
  const systemPrompt = [basePrompt, ctx, BRAND_VOICE_TAGS_BLOCK].filter(Boolean).join('\n\n')

  const insightsSection = keyInsights.length
    ? `\n\nKEY INSIGHTS FROM THIS SERVICE (use to add depth and choose the most resonant angles):\n${keyInsights.map((ins, i) => `${i + 1}. ${ins}`).join('\n')}`
    : ''

  const userPrompt =
    `Create exactly 5 Instagram carousel concepts from this sermon transcript, one per layout in the system prompt.\n\n` +
    `Layouts 1-4 must each pull from a DIFFERENT angle, quote, or theme. No reused quotes across carousels.\n` +
    `Layout 5 is a single-slide graphic. Choose the single strongest quote or verse from the sermon.\n\n` +
    `For each concept include a "citations" field listing ALL verbatim quotes from the transcript that the carousel draws from.\n\n` +
    (deliverableIntel ? `\nChurch-specific guidance for this deliverable:\n${deliverableIntel}\n\n` : '') +
    `Transcript:\n${transcript.slice(0, 30000)}` +
    insightsSection +
    (userGuidance ? `\n\nSPECIAL DIRECTION: "${userGuidance}"` : '')

  try {
    const result = await callGateway<{ options: any[] }>({
      model:    'anthropic/claude-sonnet-4-6',
      system:   systemPrompt,
      user:     userPrompt,
      toolName: 'suggest_carousels',
      toolDescription: 'Return 4 Instagram carousel options with slides[], citations[], caption, and brand-voice tags.',
      toolSchema: SLIDES_TOOL_SCHEMA,
      maxTokens: 6000,
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
