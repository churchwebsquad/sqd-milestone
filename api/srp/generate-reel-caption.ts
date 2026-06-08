/**
 * Vercel Serverless Function — /api/srp/generate-reel-caption
 *
 * Writes a reel caption for ONE clip. Caller passes the clip number
 * (1 or 2) and the clip context (quote, category). The endpoint
 * writes to the corresponding column on sms_srp_generation
 * (reel1_caption or reel2_caption).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { callAnthropic, resolvePromptOverride } from './_lib/anthropic.js'

export const maxDuration = 45

const REEL_CAPTION_DEFAULT = `You are an Instagram copywriter for churches. Write short, punchy Reel captions.

STYLE RULES:
- Keep it SHORT. 1-3 sentences max before hashtags. Think Instagram-native.
- Avoid em dashes. Use periods, commas, or line breaks.
- Do NOT repeat the sermon quote verbatim. Capture the essence in your own words.
- Be relatable, warm, and conversational. Connect to everyday life.
- Vary your approach across captions:
  - A thought-provoking question
  - A call to action that inspires change
  - A practical takeaway
  - A short list of ways to live it out
- Use emojis sparingly (1-2 max).

Return ONLY the caption text. No preamble.`

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const sessionId  = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null
  const clipNumber = req.body?.clipNumber === 2 ? 2 : 1  // default to 1
  const quote      = typeof req.body?.quote === 'string' ? req.body.quote : ''
  const category   = typeof req.body?.category === 'string' ? req.body.category : ''
  const label      = typeof req.body?.label === 'string' ? req.body.label : ''
  const churchName = typeof req.body?.churchName === 'string' ? req.body.churchName : ''
  const sermonContext = typeof req.body?.sermonContext === 'string' ? req.body.sermonContext : ''
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  if (!quote) return res.status(400).json({ error: 'quote required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const override = await resolvePromptOverride(sb, 'reel_caption')
  const systemPrompt = override ?? REEL_CAPTION_DEFAULT

  const userPrompt = [
    churchName ? `Church: ${churchName}` : '',
    `Clip ${clipNumber}: ${label || category || 'Reel'}`,
    `Quote from the sermon: "${quote}"`,
    sermonContext ? `\nBroader sermon context:\n${sermonContext.slice(0, 8000)}` : '',
    '',
    'Write the reel caption for this clip.',
  ].filter(Boolean).join('\n\n')

  let result
  try {
    result = await callAnthropic({ systemPrompt, userPrompt, maxTokens: 600 })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Anthropic call failed' })
  }

  const caption = result.text.trim()

  const column = clipNumber === 2 ? 'reel2_caption' : 'reel1_caption'
  const { error: writeErr } = await sb
    .from('sms_srp_generation')
    .update({ [column]: caption, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    caption,
    clip_number: clipNumber,
    usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
  })
}
