/**
 * Vercel Serverless Function — /api/srp/generate-facebook-post
 *
 * Generates a Facebook text post from sermon context. The default
 * prompt enforces paragraph breaks at natural beats — the previous
 * version of this generator returned one wall of text and was the
 * top item on the Loom punch list.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { callAnthropic, resolvePromptOverride } from './_lib/anthropic.js'

export const maxDuration = 60

// Inline default text so the endpoint doesn't import the browser-side
// src/lib/srpPrompts.ts (which depends on the supabase client). Source
// of truth lives there; this is a server-side mirror of the default.
const FACEBOOK_POST_DEFAULT = `You are a social media copywriter for churches. Write engaging Facebook text posts inspired by sermon content.

FORMATTING RULES (mission-critical — the previous version of this generator routinely failed these):
- Insert paragraph breaks at natural beats. Do NOT return one wall of text. A good Facebook post is 3-5 short paragraphs, each 1-2 sentences.
- Lead with a hook line (a question, observation, or short declarative). Then a blank line. Then the body. Then a closing call-to-action.
- Avoid em dashes. Use periods, commas, or line breaks instead.
- Authentic, conversational tone — not preachy.
- End with one short call-to-engagement: a question to readers, an invitation to a Sunday service, or a tag-a-friend prompt.

Return ONLY the post text. No preamble, no "Here is your post:", no commentary.`

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: 'Missing Supabase env vars' })
  }

  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null
  const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const sermonTitle = typeof req.body?.sermonTitle === 'string' ? req.body.sermonTitle : ''
  const churchName = typeof req.body?.churchName === 'string' ? req.body.churchName : ''
  const additionalContext = typeof req.body?.additionalContext === 'string' ? req.body.additionalContext : ''

  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  if (!transcript && !sermonTitle && !additionalContext) {
    return res.status(400).json({ error: 'transcript or sermonTitle required' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const override = await resolvePromptOverride(sb, 'facebook_post')
  const systemPrompt = override ?? FACEBOOK_POST_DEFAULT

  const userPrompt = [
    churchName ? `Church: ${churchName}` : '',
    sermonTitle ? `Sermon title: ${sermonTitle}` : '',
    additionalContext ? `Additional context from the team:\n${additionalContext}` : '',
    transcript ? `Sermon transcript:\n${transcript.slice(0, 18000)}` : '',
    '',
    'Write the Facebook post now.',
  ].filter(Boolean).join('\n\n')

  let result
  try {
    result = await callAnthropic({ systemPrompt, userPrompt, maxTokens: 1500 })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Anthropic call failed' })
  }

  const post = result.text.trim()

  const { error: writeErr } = await sb
    .from('sms_srp_generation')
    .update({ facebook_post: post, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    facebook_post: post,
    usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
    prompt_source: override ? 'db' : 'default',
  })
}
