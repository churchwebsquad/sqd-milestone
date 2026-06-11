/**
 * Vercel Serverless Function — /api/srp/save-clip-template
 *
 * Saves per-account creative direction defaults to
 * srp_pipeline.clip_templates. When the coach checks "Save as default
 * for {church}" on the CreativeDirection step, this writes the
 * srp_template / background_music / designer_notes selections so the
 * next session for the same church pre-fills them.
 *
 *   POST { member, srp_template?, background_music?, designer_notes?, template_name? }
 *   → 200 { ok, template_id }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 15

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const member         = typeof req.body?.member === 'number' ? req.body.member
                       : typeof req.body?.member === 'string' ? parseFloat(req.body.member) : NaN
  const srpTemplate    = typeof req.body?.srp_template     === 'string' ? req.body.srp_template     : null
  const backgroundMusic = typeof req.body?.background_music === 'boolean' ? req.body.background_music : false
  const designerNotes   = typeof req.body?.designer_notes   === 'string' ? req.body.designer_notes   : null
  const templateName    = typeof req.body?.template_name    === 'string' && req.body.template_name.trim()
                       ? req.body.template_name.trim()
                       : 'Default'

  if (!Number.isFinite(member)) return res.status(400).json({ error: 'member required (numeric)' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Upsert by unique (member, template_name).
  const { data, error } = await sb
    .schema('srp_pipeline')
    .from('clip_templates')
    .upsert(
      {
        member,
        template_name: templateName,
        srp_template:    srpTemplate,
        background_music: backgroundMusic,
        designer_notes:  designerNotes,
        is_default:      templateName === 'Default',
      },
      { onConflict: 'member,template_name' },
    )
    .select('id')
    .single()
  if (error) return res.status(500).json({ error: `Save failed: ${error.message}` })

  return res.status(200).json({ ok: true, template_id: data?.id, template_name: templateName })
}
