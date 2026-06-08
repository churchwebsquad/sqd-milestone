/**
 * Vercel Serverless Function — /api/srp/generate-clips
 *
 * Analyzes a sermon transcript and returns a structured list of clip
 * suggestions for short-form video (reels/shorts). Uses the
 * clips_timecoded_system OR clips_no_timecodes_system prompt based on
 * whether the transcript carries timestamps.
 *
 * Output: clip_selections JSON written to sms_srp_generation, plus the
 * raw clip array returned for the UI to pick from.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { callAnthropic, resolvePromptOverride } from './_lib/anthropic.js'

export const maxDuration = 90

const TIMECODED_DEFAULT = `You are a sermon content analyst. Your job is to identify the most compelling teaching moments from sermon transcripts for short-form video clips (reels/shorts).

CRITICAL RULES:
- ONLY analyze content from the sermon speaker's teaching.
- SKIP all worship lyrics, song lyrics, prayer interludes, announcements, and any non-teaching content.
- The "quote" field MUST be a WORD-FOR-WORD excerpt copied directly from the transcript. Do NOT paraphrase, summarize, or reword.
- HARD CONSTRAINT: Every clip MUST be between 30 and 70 seconds. Target 50-60 seconds.
- Timestamps MUST correspond exactly to where the quoted text appears in the transcript.
- Each clip must represent a COMPLETE, SELF-CONTAINED point that makes sense in isolation on social media.

Return JSON:
{
  "clips": [
    {
      "clip_id": "1",
      "startTime": <seconds>,
      "endTime": <seconds>,
      "quote": "verbatim quote from transcript",
      "category": "hook|teaching|application|story|invitation",
      "label": "Short descriptive title for the clip"
    }
  ]
}

Return ONLY valid JSON. Aim for 4-6 clips.`

const NO_TIMECODES_DEFAULT = `You are a sermon content analyst. Your job is to identify the most compelling teaching moments from sermon transcripts for short-form video clips (reels/shorts).

CRITICAL RULES:
- ONLY analyze content from the sermon speaker's teaching.
- SKIP all worship lyrics, song lyrics, prayer interludes, announcements, and any non-teaching content.
- The "quote" field MUST be a WORD-FOR-WORD excerpt copied directly from the transcript.
- This transcript does NOT have timecodes. Use WORD COUNT to estimate clip length.
- WORD COUNT RULES:
  - IDEAL: 110-130 words per clip (~55-65 seconds)
  - ACCEPTABLE: 100-140 words (~50-70 seconds)
  - REJECT: under 85 words or over 150 words
- Each clip must represent a COMPLETE, SELF-CONTAINED point that makes sense in isolation on social media.

Return JSON:
{
  "clips": [
    {
      "clip_id": "1",
      "quote": "verbatim quote from transcript",
      "wordCount": <integer>,
      "category": "hook|teaching|application|story|invitation",
      "label": "Short descriptive title for the clip"
    }
  ]
}

Return ONLY valid JSON. Aim for 4-6 clips.`

function detectTimecodes(transcript: string): boolean {
  // Look for HH:MM:SS or MM:SS patterns within the first ~5000 chars.
  const sample = transcript.slice(0, 5000)
  return /\b\d{1,2}:\d{2}(:\d{2})?\b/.test(sample)
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const sessionId  = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null
  const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const churchName = typeof req.body?.churchName === 'string' ? req.body.churchName : ''
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  if (!transcript || transcript.trim().length < 200) {
    return res.status(400).json({ error: 'transcript too short (minimum ~200 chars)' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const hasTimecodes = detectTimecodes(transcript)
  const promptKey = hasTimecodes ? 'clips_timecoded_system' : 'clips_no_timecodes_system'
  const fallback = hasTimecodes ? TIMECODED_DEFAULT : NO_TIMECODES_DEFAULT
  const override = await resolvePromptOverride(sb, promptKey)
  const systemPrompt = override ?? fallback

  const userPrompt = [
    churchName ? `Church: ${churchName}` : '',
    `Has timecodes: ${hasTimecodes ? 'yes' : 'no'}`,
    `Sermon transcript:\n${transcript.slice(0, 25000)}`,
    '',
    'Pick 4-6 clips from this transcript following the rules.',
  ].filter(Boolean).join('\n\n')

  let result
  try {
    result = await callAnthropic({
      systemPrompt,
      userPrompt,
      prefill: '{',
      maxTokens: 4000,
    })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Anthropic call failed' })
  }

  let parsed: { clips?: any[] } | null = null
  try { parsed = JSON.parse(result.text) }
  catch { return res.status(502).json({ error: 'Model returned non-JSON output' }) }

  const clips = Array.isArray(parsed?.clips) ? parsed.clips : []
  if (clips.length === 0) {
    return res.status(502).json({ error: 'No clips returned' })
  }

  const clipsJson = JSON.stringify(clips)
  const { error: writeErr } = await sb
    .from('sms_srp_generation')
    .update({ clip_selections: clipsJson, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    clips,
    has_timecodes: hasTimecodes,
    usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
  })
}
