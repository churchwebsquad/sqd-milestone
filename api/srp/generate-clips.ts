/**
 * Vercel Serverless Function — /api/srp/generate-clips
 *
 * Analyzes a sermon transcript and returns 8 clip suggestions for
 * short-form video (Reels/Shorts). Branches on whether the transcript
 * carries timestamps:
 *   - hasTimecodes: clips return startTime/endTime/quote/category
 *   - no timecodes: clips return quote/wordCount/estimatedSeconds/category
 *
 * Server-side filter rejects clips outside duration / word-count
 * envelope as defense-in-depth (the prompt already enforces it).
 *
 *   POST { transcript, brandVoice?, accountContext?, hasTimecodes? }
 *   → 200 { clips }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  callGateway,
  resolvePrompt,
  GatewayRateLimitError,
  GatewayTransientError,
  type ToolSchema,
} from './_lib/aiGateway.js'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 90

const SYSTEM_PROMPT = `You are a sermon content analyst. Your job is to identify the most compelling, self-contained teaching moments from sermon transcripts and package them as short-form video clips (Reels/Shorts).

WHAT YOU ARE ANALYZING:
ONLY the sermon speaker's teaching. Nothing else.
SKIP all worship lyrics, song lyrics, prayer interludes, announcements, transitions, greetings, housekeeping, offering talks, and any content that is not the speaker delivering the sermon message.
If you are unsure whether a section is part of the sermon teaching, skip it. When in doubt, leave it out.

VOICE GUIDE:
If a voice guide has been provided, use it to inform which types of moments you prioritize — not to rewrite anything. The voice guide shapes your editorial judgment (what feels on-brand, what the church would want to highlight), but it must never alter the transcript text itself.

THE QUOTE — THIS IS NON-NEGOTIABLE:
The "quote" field MUST be copied WORD FOR WORD directly from the transcript. Every word, every pause, every filler word exactly as it appears.
Do NOT paraphrase. Do NOT summarize. Do NOT clean up grammar. Do NOT remove filler words. Do NOT reword for clarity.
If the speaker said "um" or "you know" or repeated themselves, that stays in the quote. The video editor needs the exact words to match the audio.
After selecting a quote, re-read it against the transcript character by character. If even one word is different, fix it.

CLIP LENGTH — HARD CONSTRAINT:
Every clip MUST be between 30 and 90 seconds long. No exceptions.
STRONGLY PREFER 30-50 seconds. This is the sweet spot for Reels performance.
50-90 seconds is acceptable only when the moment genuinely requires it — do not pad or stretch to fill time.
Calculate duration using the transcript timestamps. End timestamp minus start timestamp must fall within 30 and 90 seconds.
If a compelling moment runs shorter than 30 seconds, look for a natural starting point earlier in the transcript where the speaker begins setting up that moment. Include the setup.
If a compelling moment runs longer than 50 seconds, find a natural breaking point where one complete thought ends before the next begins. Trim to the strongest complete thought that lands within 30-50 seconds if at all possible.
Do NOT stretch a clip to meet the minimum by including unrelated content before or after. The entire clip must be one cohesive idea.

TIMESTAMPS:
Start and end timestamps MUST correspond exactly to where the quoted text begins and ends in the transcript.
Double-check that the first word of your quote matches the word at your start timestamp.
Double-check that the last word of your quote matches the word at your end timestamp.
If the transcript uses a specific timestamp format, mirror it exactly.

WHAT MAKES A GREAT CLIP:
Each clip must be a COMPLETE, SELF-CONTAINED point that makes sense in isolation on social media. Someone with zero context should be able to watch the clip and get something meaningful from it.
Look for:
- The "quotable" moment: A bold, concise statement that could stand alone as a caption.
- The reframe: A moment where the speaker takes a familiar idea and flips it.
- The practical breakthrough: A clear, actionable insight someone can apply immediately.
- The emotional peak: A moment where the speaker's delivery intensifies — voice drops, pace changes, passion rises.
- The story payoff: The moment a story or illustration lands its point.
- The tension and resolution: A moment that names a struggle then offers a path through it. Both halves must be present.

WHAT TO AVOID:
- Clips that start mid-thought.
- Clips that end mid-thought.
- Inside references (e.g. "like I mentioned last week").
- Slow buildups with weak payoffs.
- Repetitive selections — each clip must highlight a different idea.

HOW MANY CLIPS:
Identify 6-10 clips per sermon, ranked by social media potential.
Rank 1 is the clip you'd post if you could only post one.
If the sermon doesn't have 6 strong candidates, generate fewer. Four great clips beat eight mediocre ones.`

const CATEGORY_ENUM = ['Profound Ideas', 'Practical Application', 'Challenges', 'Encouragement', 'Life of Jesus'] as const

interface ClipOutput {
  clip_title:       string
  startTime:        string
  endTime:          string
  duration:         number
  quote:            string
  category:         typeof CATEGORY_ENUM[number]
  why_this_clip:    string
  suggested_hook:   string
  caption_angle:    string
  wordCount?:       number
  estimatedSeconds?: number
}

const TIMECODED_TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          clip_title:     { type: 'string',  description: '5-8 word internal title identifying the moment.' },
          startTime:      { type: 'string',  description: 'Start timestamp matching the transcript format exactly.' },
          endTime:        { type: 'string',  description: 'End timestamp matching the transcript format exactly.' },
          duration:       { type: 'number',  description: 'Duration in seconds (endTime minus startTime). Must be 25-90.' },
          quote:          { type: 'string',  description: 'EXACT word-for-word text from the transcript. Verbatim — no edits.' },
          category:       { type: 'string',  enum: [...CATEGORY_ENUM] },
          why_this_clip:  { type: 'string',  description: '1-2 sentences: why this moment works as a standalone clip.' },
          suggested_hook: { type: 'string',  description: '5-10 word text overlay for the first 2 seconds to stop the scroll.' },
          caption_angle:  { type: 'string',  description: 'One sentence: angle the caption writer should take for the post.' },
        },
        required: ['clip_title', 'startTime', 'endTime', 'duration', 'quote', 'category', 'why_this_clip', 'suggested_hook', 'caption_angle'],
        additionalProperties: false,
      },
    },
  },
  required: ['clips'],
  additionalProperties: false,
}

const WORDCOUNT_TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          clip_title:       { type: 'string', description: '5-8 word internal title identifying the moment.' },
          quote:            { type: 'string', description: 'EXACT word-for-word text from the transcript. Verbatim — no edits.' },
          wordCount:        { type: 'number', description: 'Exact number of words in the quote.' },
          estimatedSeconds: { type: 'number', description: 'Estimated duration in seconds.' },
          category:         { type: 'string', enum: [...CATEGORY_ENUM] },
          why_this_clip:    { type: 'string', description: '1-2 sentences: why this moment works as a standalone clip.' },
          suggested_hook:   { type: 'string', description: '5-10 word text overlay for the first 2 seconds to stop the scroll.' },
          caption_angle:    { type: 'string', description: 'One sentence: angle the caption writer should take for the post.' },
        },
        required: ['clip_title', 'quote', 'wordCount', 'estimatedSeconds', 'category', 'why_this_clip', 'suggested_hook', 'caption_angle'],
        additionalProperties: false,
      },
    },
  },
  required: ['clips'],
  additionalProperties: false,
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const transcript     = typeof req.body?.transcript    === 'string'   ? req.body.transcript    : ''
  const brandVoice     = typeof req.body?.brandVoice     === 'string'   ? req.body.brandVoice     : ''
  const accountContext = (req.body?.accountContext ?? {}) as Record<string, any>
  const hasTimecodes   = req.body?.hasTimecodes !== false
  // Quotes of already-pinned clips so the AI knows to avoid them
  const pinnedQuotes:  string[] = Array.isArray(req.body?.pinnedQuotes)  ? req.body.pinnedQuotes  : []
  const keyInsights:   string[] = Array.isArray(req.body?.keyInsights)   ? req.body.keyInsights   : []

  if (!transcript || transcript.trim().length < 200) {
    return res.status(400).json({ error: 'transcript too short (minimum ~200 chars)' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const ctxParts: string[] = []
  if (brandVoice)                       ctxParts.push(`Voice guide:\n${brandVoice}`)
  if (accountContext?.speakAs)          ctxParts.push(`Speak to the audience as: ${accountContext.speakAs}`)
  if (accountContext?.bibleTranslation) ctxParts.push(`Preferred Bible translation: ${accountContext.bibleTranslation}`)
  if (accountContext?.platforms)        ctxParts.push(`Target platforms: ${accountContext.platforms}`)
  const ctx = ctxParts.join('\n\n')

  const basePrompt = (await resolvePrompt(sb, 'clips_system')) ?? SYSTEM_PROMPT
  const systemPrompt = [basePrompt, ctx].filter(Boolean).join('\n\n')

  const insightsSection = keyInsights.length
    ? `\n\nKEY INSIGHTS FROM THIS SERVICE (use these to guide clip prioritization — clips that illuminate these insights rank higher):\n${keyInsights.map((ins, i) => `${i + 1}. ${ins}`).join('\n')}`
    : ''

  const pinnedSection = pinnedQuotes.length
    ? `\n\nIMPORTANT — ALREADY SELECTED (DO NOT REPEAT THESE):
The following clips have already been selected and pinned by the coach. Your suggestions must come from DIFFERENT parts of the transcript. Do not suggest anything overlapping with these quotes:\n${pinnedQuotes.map((q, i) => `${i + 1}. "${q.slice(0, 120)}…"`).join('\n')}`
    : ''

  const durationRule = hasTimecodes
    ? 'DURATION: Every clip MUST be between 30 and 90 seconds. STRONGLY PREFER 30-50 seconds. 50-90 only when the moment truly requires it. Calculate from timestamps.'
    : 'WORD COUNT: IDEAL 110-130 words (≈55-65 sec). ACCEPTABLE 100-140 words. REJECT under 85 or over 150 words.'

  const userPrompt = `Analyze this sermon transcript and identify 6-10 compelling teaching moments for short-form video clips, ranked by social media potential (rank 1 = best single clip).

${durationRule}

THE QUOTE IS NON-NEGOTIABLE: Copy it WORD FOR WORD from the transcript. Every filler word, every pause, exactly as spoken. The video editor must match it to the audio.${insightsSection}${pinnedSection}

Transcript:
${transcript.slice(0, 60000)}`

  try {
    const result = await callGateway<{ clips: ClipOutput[] }>({
      system: systemPrompt,
      user:   userPrompt,
      toolName: 'suggest_clips',
      toolDescription: 'Return 6-10 ranked sermon clip suggestions with verbatim quotes, timestamps, hooks, and caption angles.',
      toolSchema: hasTimecodes ? TIMECODED_TOOL_SCHEMA : WORDCOUNT_TOOL_SCHEMA,
      maxTokens: 10000,
    })

    const rawClips = Array.isArray(result.args.clips) ? result.args.clips : []

    const clips = rawClips
      .map(c => {
        if (!hasTimecodes) {
          const actualWordCount = c.quote.split(/\s+/).filter(Boolean).length
          return {
            ...c,
            startTime:        '',
            endTime:          '',
            wordCount:        actualWordCount,
            estimatedSeconds: Math.round(actualWordCount / 2),
            duration:         Math.round(actualWordCount / 2),
          }
        }
        return { ...c, duration: parseTimestamp(c.endTime) - parseTimestamp(c.startTime) }
      })
      .filter(c => {
        if (hasTimecodes) return c.duration >= 30 && c.duration <= 90
        return (c.wordCount ?? 0) >= 85 && (c.wordCount ?? 0) <= 150
      })
      // Drop any clips whose quote overlaps with pinned clips
      .filter(c => !pinnedQuotes.some(pq =>
        pq.length > 20 && c.quote.includes(pq.slice(0, 40)),
      ))

    return res.status(200).json({
      clips,
      has_timecodes: hasTimecodes,
      usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
    })
  } catch (e) {
    if (e instanceof GatewayRateLimitError) return res.status(429).json({ error: 'Rate limit exceeded. Please try again in a moment.' })
    if (e instanceof GatewayTransientError) return res.status(502).json({ error: e.message })
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Clip generation failed' })
  }
}
