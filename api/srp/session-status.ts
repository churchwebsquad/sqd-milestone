/**
 * GET /api/srp/session-status?days=7
 * Returns all sessions from the last N days with transcript/auto_drafts status.
 * Used by the admin status page to verify auto-generation ran.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 15

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Show sessions from the last 10 days (covers full Fri-Thu week + a few days buffer for
  // sessions created Thursday before the Fri week boundary)
  const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await sb
    .schema('srp_pipeline')
    .from('sessions')
    .select('session_id, church_name, sermon_title, created_at, updated_at, transcript, auto_drafts, selected_deliverables, current_step, video_url')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const rows = (data ?? []).map((s: any) => {
    const drafts = s.auto_drafts as Record<string, any> | null
    const deliverables: string[] = Array.isArray(s.selected_deliverables) ? s.selected_deliverables : []
    const hasReels = deliverables.some((d: string) => /^reel\d+$/.test(d))

    const needed = [
      'overview',
      ...(hasReels ? ['clips'] : []),
      ...(deliverables.includes('carousel')    ? ['carousel']    : []),
      ...(deliverables.includes('facebook')    ? ['facebook']    : []),
      ...(deliverables.includes('photoRecap')  ? ['photoRecap']  : []),
      ...(deliverables.includes('sundayInvite') ? ['sundayInvite'] : []),
    ]

    const generated = drafts ? Object.keys(drafts) : []
    const missing   = needed.filter(k => !generated.includes(k))

    const hasTranscript = Boolean(s.transcript && s.transcript.length > 200)

    return {
      session_id:      s.session_id,
      church_name:     s.church_name ?? '(unnamed)',
      sermon_title:    s.sermon_title ?? '',
      created_at:      s.created_at,
      current_step:    s.current_step,
      video_url:       s.video_url ?? null,
      has_video_url:   Boolean(s.video_url),
      has_transcript:  hasTranscript,
      has_auto_drafts: Boolean(drafts),
      deliverables,
      generated,
      missing,
      ready: hasTranscript && Boolean(drafts) && missing.length === 0,
    }
  })

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ rows })
}
