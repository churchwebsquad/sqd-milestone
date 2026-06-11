/**
 * Vercel Serverless Function — /api/srp/start-clipcutter
 *
 * Creates a clipcutter_jobs row in srp_pipeline, then fires the n8n
 * clipcutter webhook. n8n renders each clip into an MP4 (and optional
 * SRT) and POSTs results back to /api/srp/clipcutter-callback.
 *
 * Env:
 *   SRP_N8N_CLIPCUTTER_WEBHOOK_URL
 *   SRP_N8N_CALLBACK_SECRET
 *
 *   POST { session_id, clips, creative_direction? }
 *     clips: [{ clip_id, clip_name, in_point_ms, out_point_ms, duration_ms, quote, category, caption_text?, caption_srt? }]
 *     creative_direction: { srp_template?, background_music?, designer_notes? }
 *   → 200 { job_id, status: "pending", clip_count, webhook_status }
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

  const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id
                  : typeof req.body?.sessionId  === 'string' ? req.body.sessionId : null
  const clips    = Array.isArray(req.body?.clips) ? req.body.clips : []
  const creative = req.body?.creative_direction && typeof req.body.creative_direction === 'object'
                  ? req.body.creative_direction
                  : null
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })
  if (clips.length === 0) return res.status(400).json({ error: 'clips required (non-empty array)' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Read source_url + source_type from the parent session — n8n needs both.
  const { data: session, error: sessErr } = await sb
    .schema('srp_pipeline')
    .from('sessions')
    .select('video_url, video_source_type')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (sessErr || !session) return res.status(404).json({ error: sessErr?.message ?? 'Session not found' })

  const videoUrl    = session.video_url as string | null
  const sourceType  = (session.video_source_type as string | null) ?? 'unknown'
  if (!videoUrl) return res.status(400).json({ error: 'No video_url on session — transcribe first or paste a URL' })

  // Create clipcutter_jobs row. Its UUID is the n8n job_id.
  const { data: job, error: jobErr } = await sb
    .schema('srp_pipeline')
    .from('clipcutter_jobs')
    .insert({
      session_id:        sessionId,
      source_url:        videoUrl,
      source_type:       sourceType,
      clips,
      creative_direction: creative,
      status:            'pending',
      progress_percent:  0,
    })
    .select('id')
    .single()
  if (jobErr || !job) {
    return res.status(500).json({ error: `Failed to create clipcutter job: ${jobErr?.message ?? 'unknown'}` })
  }
  const jobId = job.id as string

  // Stamp the parent session with the job id + processing status so the
  // UI knows clipping started even if Realtime hasn't connected yet.
  await sb
    .schema('srp_pipeline')
    .from('sessions')
    .update({
      clipcutter_job_id:      jobId,
      clip_processing_status: 'pending',
    })
    .eq('session_id', sessionId)

  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string)
  const baseUrl = host
    ? `${proto}://${host}`
    : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  const payload = {
    job_id:             jobId,
    session_id:         sessionId,
    source_url:         videoUrl,
    source_type:        sourceType,
    clips,
    creative_direction: creative,
    callback_url:       `${baseUrl}/api/srp/clipcutter-callback`,
    callback_secret:    callbackSecret,
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
      await sb
        .schema('srp_pipeline')
        .from('clipcutter_jobs')
        .update({
          status: 'failed',
          error_message: `n8n webhook returned ${r.status}: ${text.slice(0, 300)}`,
        })
        .eq('id', jobId)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    if (msg.includes('aborted') || msg.includes('TimeoutError')) {
      webhookOk = true
      console.warn(`[start-clipcutter] webhook timed out (n8n still running)`)
    } else {
      await sb
        .schema('srp_pipeline')
        .from('clipcutter_jobs')
        .update({ status: 'failed', error_message: `webhook fetch failed: ${msg}` })
        .eq('id', jobId)
      return res.status(502).json({ error: `n8n webhook failed: ${msg}`, job_id: jobId })
    }
  }

  return res.status(200).json({
    job_id:         jobId,
    session_id:     sessionId,
    clip_count:     clips.length,
    status:         'pending',
    webhook_status: webhookOk ? 'accepted' : 'failed',
  })
}
