/**
 * Vercel Serverless Function — /api/srp/generate-sunday-invite
 *
 * 3 invite variants per call (warm, energetic, topical). Church name
 * and service times go at the BOTTOM of every variant — the previous
 * version put them at the top and the team has called this out
 * repeatedly.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { callAnthropic, resolvePromptOverride } from './_lib/anthropic.js'

export const maxDuration = 60

const SYSTEM_DEFAULT = `You are a social media copywriter for churches. Write Sunday service invite posts that focus on inviting people to attend this upcoming Sunday's service. The primary goal is to make someone feel welcomed and excited to visit or return.

FORMATTING RULES:
- Each invite is 2-4 sentences.
- Place the church name and service times AT THE BOTTOM of each variant, not the top. Like a sign-off, not a headline.
- Avoid em dashes. Use periods, commas, or line breaks instead.

Use the placeholders [Church Name] and [Service Times] verbatim — the team fills those in after generation.

Return JSON with this exact shape:
{
  "invites": [
    { "tone": "warm",      "post": "...", "citation": "..." },
    { "tone": "energetic", "post": "...", "citation": "..." },
    { "tone": "topical",   "post": "...", "citation": "..." }
  ]
}

Return ONLY valid JSON. No preamble.`

const USER_DEFAULT = `Write 3 Sunday service invite posts with different tones:

1. WARM: A welcoming generic invitation. Do NOT reference the sermon topic. Focus purely on community, belonging, and showing up.
2. ENERGETIC: A compelling generic invitation. Do NOT reference the sermon topic. Focus on excitement, energy, and what it feels like to be part of this church.
3. TOPICAL: An invitation that briefly teases what will be discussed this Sunday based on the sermon context. Keep the sermon reference to one short phrase, not a summary.

For each invite, provide a "citation" field. For options 1 and 2, use a short general quote from the transcript about community or faith. For option 3, use a verbatim quote related to the topic teaser.

End EVERY invite with [Church Name] · [Service Times] as a sign-off line.`

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const sessionId  = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null
  const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const sermonTitle = typeof req.body?.sermonTitle === 'string' ? req.body.sermonTitle : ''
  const churchName = typeof req.body?.churchName === 'string' ? req.body.churchName : ''
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const sysOverride = await resolvePromptOverride(sb, 'sunday_invite_system')
  const usrOverride = await resolvePromptOverride(sb, 'sunday_invite_user')
  const systemPrompt = sysOverride ?? SYSTEM_DEFAULT
  const userBody = usrOverride ?? USER_DEFAULT

  const userPrompt = [
    churchName ? `Church: ${churchName}` : '',
    sermonTitle ? `Sermon title: ${sermonTitle}` : '',
    transcript ? `Sermon context (use only for the TOPICAL variant):\n${transcript.slice(0, 12000)}` : '',
    '',
    userBody,
  ].filter(Boolean).join('\n\n')

  let result
  try {
    result = await callAnthropic({
      systemPrompt,
      userPrompt,
      prefill: '{',
      maxTokens: 1500,
    })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Anthropic call failed' })
  }

  let parsed: { invites?: Array<{ tone: string; post: string; citation: string }> } | null = null
  try { parsed = JSON.parse(result.text) }
  catch { return res.status(502).json({ error: 'Model returned non-JSON output' }) }

  const invites = Array.isArray(parsed?.invites) ? parsed.invites : []
  // Store the formatted text for the DB column (text, not JSON). The
  // UI renders all three variants from this single string for now;
  // future Phase 2 enhancement: split out into individual fields if
  // the team needs per-variant editing.
  const formatted = invites.map(i => `[${(i.tone ?? '').toUpperCase()}]\n${i.post ?? ''}${i.citation ? `\n\n(citation: ${i.citation})` : ''}`).join('\n\n---\n\n')

  const { error: writeErr } = await sb
    .from('sms_srp_generation')
    .update({ sunday_invite: formatted, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    sunday_invite: formatted,
    invites,
    usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
  })
}
