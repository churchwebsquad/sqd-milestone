/**
 * Vercel Serverless Function — /api/srp/clipcutter-callback
 *
 * Receives clip rendering results from the n8n clipcutter workflow.
 * Merges video_url + srt_url into the matching entries inside
 * sms_srp_generation.clip_selections, keyed by clip_id.
 *
 * Expected body:
 *   {
 *     job_id, session_id, callback_secret,
 *     status: 'completed' | 'failed' | 'partial',
 *     clip_results: [
 *       { clip_id, video_url, srt_url?, status: 'done' | 'failed', error_message? }
 *     ],
 *     error_message?: string
 *   }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const expectedSecret = process.env.SRP_N8N_CALLBACK_SECRET
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })
  if (!expectedSecret) return res.status(500).json({ error: 'SRP_N8N_CALLBACK_SECRET not configured' })

  const authHeader = (req.headers.authorization ?? req.headers.Authorization ?? '') as string
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const bodySecret = typeof req.body?.callback_secret === 'string' ? req.body.callback_secret : ''
  const providedSecret = bearerSecret || bodySecret
  if (providedSecret !== expectedSecret) return res.status(401).json({ error: 'Unauthorized' })

  const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id : null
  const clipResults = Array.isArray(req.body?.clip_results) ? req.body.clip_results : []
  const status = typeof req.body?.status === 'string' ? req.body.status : 'completed'
  const errorMessage = typeof req.body?.error_message === 'string' ? req.body.error_message : null

  if (!sessionId) return res.status(400).json({ error: 'session_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: session, error: sessErr } = await sb
    .from('sms_srp_generation')
    .select('clip_selections')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (sessErr || !session) return res.status(404).json({ error: sessErr?.message ?? 'Session not found' })

  let allClips: any[] = []
  try { allClips = JSON.parse(String(session.clip_selections ?? '[]')) ?? [] }
  catch { return res.status(500).json({ error: 'clip_selections not valid JSON' }) }

  const resultsByClipId = new Map<string, any>()
  for (const r of clipResults) {
    if (r?.clip_id != null) resultsByClipId.set(String(r.clip_id), r)
  }

  const merged = allClips.map(c => {
    const result = resultsByClipId.get(String(c.clip_id))
    if (!result) return c
    return {
      ...c,
      video_url:          result.video_url ?? null,
      srt_url:            result.srt_url ?? null,
      processing_status:  result.status === 'failed' ? 'failed' : (result.video_url ? 'done' : 'queued'),
      processing_error:   result.error_message ?? null,
      processed_at:       new Date().toISOString(),
    }
  })

  // If the overall job failed and no per-clip results came back, mark
  // every queued clip as failed so the UI doesn't spin forever.
  const finalMerged = (status === 'failed' && clipResults.length === 0)
    ? merged.map(c => c.processing_status === 'queued'
        ? { ...c, processing_status: 'failed', processing_error: errorMessage ?? 'job failed' }
        : c)
    : merged

  const { error: writeErr } = await sb.from('sms_srp_generation')
    .update({ clip_selections: JSON.stringify(finalMerged), updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    status,
    processed: clipResults.length,
    session_id: sessionId,
  })
}
