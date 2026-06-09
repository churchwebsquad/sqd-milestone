/**
 * Vercel Serverless Function — /api/srp/start-clipcutter
 *
 * Fires the n8n clipcutter webhook with the session's video_url + the
 * picked clips. n8n renders each clip into an MP4 (and optional SRT)
 * and POSTs results back to /api/srp/clipcutter-callback.
 *
 * Required env vars:
 *   SRP_N8N_CLIPCUTTER_WEBHOOK_URL
 *   SRP_N8N_CALLBACK_SECRET           — same secret transcription uses
 *
 * Clip array stored on sms_srp_generation.clip_selections gains
 * processing_status='queued' on each picked clip; the callback fills
 * in video_url + srt_url + processing_status='done' / 'failed'.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const webhookUrl     = process.env.SRP_N8N_CLIPCUTTER_WEBHOOK_URL
  const callbackSecret = process.env.SRP_N8N_CALLBACK_SECRET
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })
  if (!webhookUrl)     return res.status(500).json({ error: 'SRP_N8N_CLIPCUTTER_WEBHOOK_URL not configured' })
  if (!callbackSecret) return res.status(500).json({ error: 'SRP_N8N_CALLBACK_SECRET not configured' })

  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null
  const pickedClipIds = Array.isArray(req.body?.pickedClipIds) ? req.body.pickedClipIds.map(String) : []
  const creativeDirection = typeof req.body?.creativeDirection === 'object' ? req.body.creativeDirection : null
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  if (pickedClipIds.length === 0) return res.status(400).json({ error: 'pickedClipIds required (non-empty)' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: session, error: sessErr } = await sb
    .from('sms_srp_generation')
    .select('clip_selections, video_url, church_name')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (sessErr || !session) return res.status(404).json({ error: sessErr?.message ?? 'Session not found' })

  const videoUrl = session.video_url as string | null
  if (!videoUrl) return res.status(400).json({ error: 'No video_url on session — transcribe first or paste a URL' })

  // Parse clip_selections JSON, filter to picked, mark queued.
  let allClips: any[] = []
  try { allClips = JSON.parse(String(session.clip_selections ?? '[]')) ?? [] }
  catch { return res.status(500).json({ error: 'clip_selections is not valid JSON' }) }

  const pickedSet = new Set(pickedClipIds)
  const picked = allClips.filter(c => pickedSet.has(String(c.clip_id)))
  if (picked.length === 0) return res.status(400).json({ error: 'No picked clips matched current clip_selections — re-pick.' })

  // Build n8n payload: one entry per clip with the timing info it needs.
  const clipsPayload = picked.map((c, i) => ({
    clip_id:       String(c.clip_id ?? `${i + 1}`),
    clip_name:     String(c.label ?? c.category ?? `Clip ${i + 1}`),
    in_point_ms:   Math.round(((c.startTime ?? 0) as number) * 1000),
    out_point_ms:  Math.round(((c.endTime ?? 0) as number) * 1000),
    duration_ms:   Math.max(0, Math.round((((c.endTime ?? 0) - (c.startTime ?? 0)) as number) * 1000)),
    quote:         c.quote,
    category:      c.category,
  }))

  // Stamp processing_status='queued' on the picked clips so the UI can
  // show progress; non-picked clips keep their previous state.
  const queuedClips = allClips.map(c => {
    if (pickedSet.has(String(c.clip_id))) {
      return { ...c, processing_status: 'queued', processing_queued_at: new Date().toISOString() }
    }
    return c
  })
  await sb.from('sms_srp_generation')
    .update({ clip_selections: JSON.stringify(queuedClips), updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)

  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string)
  const baseUrl = host ? `${proto}://${host}` : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  const job_id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? (crypto as any).randomUUID()
    : `${sessionId}_${Date.now()}`

  const payload = {
    job_id,
    session_id: sessionId,
    source_url: videoUrl,
    clips: clipsPayload,
    creative_direction: creativeDirection,
    callback_url: `${baseUrl}/api/srp/clipcutter-callback`,
    callback_secret: callbackSecret,
  }

  let webhookOk = false
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25_000),
    })
    webhookOk = r.ok
    if (!r.ok) {
      const text = await r.text()
      console.error(`[start-clipcutter] n8n webhook ${r.status}: ${text.slice(0, 300)}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    if (msg.includes('aborted') || msg.includes('TimeoutError')) {
      webhookOk = true
      console.warn(`[start-clipcutter] webhook timed out (n8n still running)`)
    } else {
      return res.status(502).json({ error: `n8n webhook failed: ${msg}` })
    }
  }

  return res.status(200).json({
    ok: true,
    job_id,
    queued_clips: clipsPayload.length,
    webhook_status: webhookOk ? 'accepted' : 'failed',
  })
}
