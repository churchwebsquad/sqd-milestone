/**
 * Vercel Serverless Function — /api/srp/generate-photo-recap
 *
 * Generates 3-5 photo-recap carousel caption options. The recap_type
 * field switches which prompt key resolves the system prompt:
 *
 *   serviceHighlights | weekendTeaching | seriesStartEnd | generalCelebration
 *
 * Each maps to a separate prompt_key in sms_prompt_settings so the
 * team can refine them independently in PromptSettings.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { callAnthropic, resolvePromptOverride } from './_lib/anthropic.js'

export const maxDuration = 60

const RECAP_PROMPT_KEYS = {
  serviceHighlights:   'photo_recap_serviceHighlights',
  weekendTeaching:     'photo_recap_weekendTeaching',
  seriesStartEnd:      'photo_recap_seriesStartEnd',
  generalCelebration:  'photo_recap_generalCelebration',
} as const

type RecapType = keyof typeof RECAP_PROMPT_KEYS

const DEFAULTS: Record<RecapType, string> = {
  serviceHighlights: `You are a social media manager for a church, writing engaging captions for a photo carousel that recaps the weekend services. Focus on creating a warm, celebratory tone that reflects the spiritual impact and sense of community.

FORMATTING:
- Concise, conversational, uplifting.
- 3-5 caption options.
- Each caption ends with a call-to-action that encourages interaction (tagging friends, sharing thoughts).
- Use relevant emojis sparingly (1-2 max per caption) and a branded hashtag.
- Insert paragraph breaks. Do not return walls of text.

Use the sermon transcript or submission details to identify event highlights, spiritual impact, and community feel.`,

  weekendTeaching: `You are a social media manager for a church, writing an engaging caption for a photo carousel that features the congregation and highlights from the weekend's service. Tone: thoughtful, faith-centered, inviting.

FORMATTING:
- Include a SHORT recap of the weekend's message (2 sentences, max).
- Conversational and inspiring; mix direct reflection with a call to action.
- 3-5 caption options.
- Insert paragraph breaks. No walls of text.`,

  seriesStartEnd: `You are a social media manager for a church, writing an engaging caption for a photo carousel that marks the beginning or end of a sermon series. Tone: personal, authentic, like you're talking to a friend.

FORMATTING:
- Mention practical or relatable details that help the reader see themselves in the moment.
- Simple, direct, warm language.
- 3-5 caption options.
- Include a gentle call-to-action.
- Insert paragraph breaks.`,

  generalCelebration: `You are a social media manager for a church, writing an engaging caption for a photo carousel that reflects on and celebrates the Sunday service experience. Focus on capturing the overall atmosphere and emotional tone.

FORMATTING:
- Warm, conversational, faith-centered.
- Talk to the reader like a friend.
- 3-5 caption options.
- Encourage sharing, commenting, or attending next week.
- Insert paragraph breaks.`,
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const sessionId   = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null
  const transcript  = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const recapType   = (req.body?.recapType ?? 'generalCelebration') as RecapType
  const churchName  = typeof req.body?.churchName === 'string' ? req.body.churchName : ''
  const seriesTitle = typeof req.body?.seriesTitle === 'string' ? req.body.seriesTitle : ''
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  if (!(recapType in RECAP_PROMPT_KEYS)) return res.status(400).json({ error: `Unknown recapType: ${recapType}` })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const promptKey = RECAP_PROMPT_KEYS[recapType]
  const override = await resolvePromptOverride(sb, promptKey)
  const systemPrompt = override ?? DEFAULTS[recapType]

  const userPrompt = [
    churchName ? `Church: ${churchName}` : '',
    seriesTitle ? `Series title: ${seriesTitle}` : '',
    transcript ? `Sermon transcript:\n${transcript.slice(0, 15000)}` : '',
    '',
    `Write 3-5 photo-recap caption options. Separate each caption with a line of three dashes (---).`,
  ].filter(Boolean).join('\n\n')

  let result
  try {
    result = await callAnthropic({ systemPrompt, userPrompt, maxTokens: 2500 })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Anthropic call failed' })
  }

  const recap = result.text.trim()

  const { error: writeErr } = await sb
    .from('sms_srp_generation')
    .update({ photo_recap_caption: recap, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    photo_recap_caption: recap,
    recap_type: recapType,
    usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
  })
}
