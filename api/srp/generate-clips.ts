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

const DEFAULT_TIMECODED_PROMPT = `You are a sermon content analyst. Your job is to identify the most compelling teaching moments from sermon transcripts for short-form video clips (reels/shorts).

CRITICAL RULES:
- ONLY analyze content from the sermon speaker's teaching.
- SKIP all worship lyrics, song lyrics, prayer interludes, announcements, and any non-teaching content.
- Focus exclusively on the speaker's sermon/message.
- The "quote" field MUST be a WORD-FOR-WORD excerpt copied directly from the transcript. Do NOT paraphrase, summarize, or reword. Copy the exact text.
- HARD CONSTRAINT: Every clip MUST be between 30 and 70 seconds. No exceptions. Target 50-60 seconds.
- Timestamps MUST correspond exactly to where the quoted text appears in the transcript.
- Each clip must represent a COMPLETE, SELF-CONTAINED point that makes sense in isolation on social media. The speaker should start and finish a thought.`

const DEFAULT_NO_TIMECODES_PROMPT = `You are a sermon content analyst. Your job is to identify the most compelling teaching moments from sermon transcripts for short-form video clips (reels/shorts).

CRITICAL RULES:
- ONLY analyze content from the sermon speaker's teaching.
- SKIP all worship lyrics, song lyrics, prayer interludes, announcements, and any non-teaching content.
- Focus exclusively on the speaker's sermon/message.
- The "quote" field MUST be a WORD-FOR-WORD excerpt copied directly from the transcript. Do NOT paraphrase, summarize, or reword. Copy the exact text.
- This transcript does NOT have timecodes. Use WORD COUNT to estimate clip length.
- WORD COUNT RULES:
  - IDEAL: 110–130 words per clip (≈55–65 seconds)
  - ACCEPTABLE: 100–140 words (≈50–70 seconds)
  - REJECT: under 85 words or over 150 words
  - Estimation formula: 60 words ≈ 30 seconds, 90 words ≈ 45 seconds, 120 words ≈ 60 seconds, 150 words ≈ 75 seconds
- Each clip must represent a COMPLETE, SELF-CONTAINED point that makes sense in isolation on social media. The speaker should start and finish a thought.`

const CATEGORY_ENUM = ['Profound Ideas', 'Practical Application', 'Challenges', 'Encouragement', 'Life of Jesus'] as const

interface TimecodedClip { startTime: string; endTime: string; quote: string; category: typeof CATEGORY_ENUM[number] }
interface WordcountClip { quote: string; wordCount: number; estimatedSeconds: number; category: typeof CATEGORY_ENUM[number] }

const TIMECODED_TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startTime: { type: 'string', description: 'Start timestamp in MM:SS or HH:MM:SS format.' },
          endTime:   { type: 'string', description: 'End timestamp in MM:SS or HH:MM:SS format.' },
          quote:     { type: 'string', description: 'The EXACT word-for-word text from the transcript for this clip segment. Verbatim, not paraphrased.' },
          category:  { type: 'string', enum: [...CATEGORY_ENUM], description: 'Which category this clip belongs to.' },
        },
        required: ['startTime', 'endTime', 'quote', 'category'],
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
          quote:            { type: 'string', description: 'The EXACT word-for-word text from the transcript. Verbatim.' },
          wordCount:        { type: 'number', description: 'Exact number of words in the quote.' },
          estimatedSeconds: { type: 'number', description: 'Estimated duration in seconds (wordCount / 2).' },
          category:         { type: 'string', enum: [...CATEGORY_ENUM], description: 'Which category this clip belongs to.' },
        },
        required: ['quote', 'wordCount', 'estimatedSeconds', 'category'],
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

  const transcript     = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const brandVoice     = typeof req.body?.brandVoice === 'string' ? req.body.brandVoice : ''
  const accountContext = (req.body?.accountContext ?? {}) as Record<string, any>
  const hasTimecodes   = req.body?.hasTimecodes !== false  // default true
  if (!transcript || transcript.trim().length < 200) {
    return res.status(400).json({ error: 'transcript too short (minimum ~200 chars)' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const ctxParts: string[] = []
  if (brandVoice)                       ctxParts.push(`Brand voice: ${brandVoice}`)
  if (accountContext?.speakAs)          ctxParts.push(`Speak to the audience as: ${accountContext.speakAs}`)
  if (accountContext?.bibleTranslation) ctxParts.push(`Preferred Bible translation: ${accountContext.bibleTranslation}`)
  if (accountContext?.platforms)        ctxParts.push(`Target platforms: ${accountContext.platforms}`)
  const ctx = ctxParts.join('\n')

  const promptKey = hasTimecodes ? 'clips_timecoded_system' : 'clips_no_timecodes_system'
  const fallback  = hasTimecodes ? DEFAULT_TIMECODED_PROMPT : DEFAULT_NO_TIMECODES_PROMPT
  const basePrompt = (await resolvePrompt(sb, promptKey)) ?? fallback
  const systemPrompt = [basePrompt, ctx].filter(Boolean).join('\n\n')

  const userPrompt = hasTimecodes
    ? `Analyze this sermon transcript and identify the 8 most compelling teaching moments for short-form video clips.

DURATION REQUIREMENTS (HARD CONSTRAINT):
- MINIMUM 30 seconds, MAXIMUM 70 seconds. Target 50-60 seconds.
- ANY clip outside the 30-70 second range will be REJECTED.
- Each clip must be a complete thought — the speaker should start and finish a point that stands alone on social media.

QUOTE REQUIREMENTS:
- Extract the EXACT VERBATIM text from the transcript for each clip's quote field.
- Do NOT paraphrase, summarize, or reword. Copy the speaker's words exactly as they appear.

Organize clips across these categories:
1. Profound Ideas
2. Practical Application
3. Challenges
4. Encouragement
5. Life of Jesus

Transcript:
${transcript.slice(0, 60000)}`
    : `Analyze this sermon transcript and identify the 8 most compelling teaching moments for short-form video clips.

WORD COUNT REQUIREMENTS (HARD CONSTRAINT):
- IDEAL: 110–130 words per clip.
- ACCEPTABLE: 100–140 words.
- ANY clip under 85 words or over 150 words will be REJECTED.
- Each clip must be a complete thought.

For each clip, count the exact number of words in the quote and estimate duration at 2 words per second.

QUOTE REQUIREMENTS:
- Extract the EXACT VERBATIM text from the transcript. Verbatim, not paraphrased.

Organize clips across these categories:
1. Profound Ideas
2. Practical Application
3. Challenges
4. Encouragement
5. Life of Jesus

Transcript:
${transcript.slice(0, 60000)}`

  try {
    const result = await callGateway<{ clips: any[] }>({
      system: systemPrompt,
      user:   userPrompt,
      toolName: 'suggest_clips',
      toolDescription: hasTimecodes
        ? 'Return 8 suggested sermon clips with timestamps, verbatim quotes, and categories.'
        : 'Return 8 suggested sermon clips with verbatim quotes, word counts, estimated durations, and categories.',
      toolSchema: hasTimecodes ? TIMECODED_TOOL_SCHEMA : WORDCOUNT_TOOL_SCHEMA,
      maxTokens: 8000,
    })

    const rawClips = Array.isArray(result.args.clips) ? result.args.clips : []
    let clips: any[]
    if (hasTimecodes) {
      clips = (rawClips as TimecodedClip[]).filter(c => {
        const dur = parseTimestamp(c.endTime) - parseTimestamp(c.startTime)
        return dur >= 30 && dur <= 70
      })
    } else {
      clips = (rawClips as WordcountClip[])
        .map(c => {
          const actualWordCount = c.quote.split(/\s+/).filter(Boolean).length
          return {
            ...c,
            startTime: '',
            endTime: '',
            wordCount: actualWordCount,
            estimatedSeconds: Math.round(actualWordCount / 2),
          }
        })
        .filter(c => c.wordCount >= 85 && c.wordCount <= 150)
    }

    return res.status(200).json({
      clips,
      has_timecodes: hasTimecodes,
      usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
    })
  } catch (e) {
    if (e instanceof GatewayRateLimitError)  return res.status(429).json({ error: 'Rate limit exceeded. Please try again in a moment.' })
    if (e instanceof GatewayTransientError)  return res.status(502).json({ error: e.message })
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Clip generation failed' })
  }
}
