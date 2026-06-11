/**
 * Vercel Serverless Function — /api/srp/save-brand-voice
 *
 * Saves the per-account brand voice guidelines that the coach pastes
 * in the AccountSelection step.
 *
 * IMPORTANT: srp-generator-main writes back to
 * strategy_account_progress.brand_voice_guidelines. CLAUDE.md forbids
 * us from modifying strategy_account_progress, so we write to
 * srp_pipeline.clip_templates.brand_voice_guidelines instead, on the
 * (member, 'Default') row. Same upsert key as save-clip-template so the
 * two endpoints coexist without conflict.
 *
 *   POST { member, brand_voice_guidelines }
 *   → 200 { ok, member, template_id }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 15

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const member             = typeof req.body?.member === 'number' ? req.body.member
                           : typeof req.body?.member === 'string' ? parseFloat(req.body.member) : NaN
  const brandVoiceText     = typeof req.body?.brand_voice_guidelines === 'string'
                           ? req.body.brand_voice_guidelines
                           : (typeof req.body?.brandVoiceGuidelines === 'string' ? req.body.brandVoiceGuidelines : null)

  if (!Number.isFinite(member)) return res.status(400).json({ error: 'member required (numeric)' })
  if (brandVoiceText === null)  return res.status(400).json({ error: 'brand_voice_guidelines required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data, error } = await sb
    .schema('srp_pipeline')
    .from('clip_templates')
    .upsert(
      {
        member,
        template_name:          'Default',
        brand_voice_guidelines: brandVoiceText,
        is_default:             true,
      },
      { onConflict: 'member,template_name' },
    )
    .select('id')
    .single()
  if (error) return res.status(500).json({ error: `Save failed: ${error.message}` })

  return res.status(200).json({ ok: true, member, template_id: data?.id })
}
