/**
 * Vercel Serverless Function — /api/srp/start-transcription
 *
 * Creates a transcript_jobs row in srp_pipeline, then fires the n8n
 * webhook with the job ID. The Phase 3 UI subscribes to that row via
 * Supabase Realtime to track progress without polling.
 *
 * Env:
 *   SRP_N8N_TRANSCRIPTION_WEBHOOK_URL — full https URL to the n8n trigger
 *   SRP_N8N_CALLBACK_SECRET           — shared secret n8n echoes in the callback
 *
 * The n8n webhook node MUST be set to "Respond Immediately" — we fire
 * the webhook then return so the UI can subscribe to the Realtime stream.
 * Long-running transcription happens in n8n; the callback updates the
 * transcript_jobs row when done.
 *
 *   POST { session_id, source_url, source_type? }
 *   → 200 { job_id, status: "pending", normalized_url, source_type, webhook_status }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { validateMediaUrl } from './_lib/mediaUrl.js'

export const maxDuration = 30

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const webhookUrl     = process.env.SRP_N8N_TRANSCRIPTION_WEBHOOK_URL
  const callbackSecret = process.env.SRP_N8N_CALLBACK_SECRET
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })
  if (!webhookUrl)     return res.status(500).json({ error: 'SRP_N8N_TRANSCRIPTION_WEBHOOK_URL not configured' })
  if (!callbackSecret) return res.status(500).json({ error: 'SRP_N8N_CALLBACK_SECRET not configured' })

  // Accept either camelCase (legacy client) or snake_case (srp-generator-main convention).
  const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id
                  : typeof req.body?.sessionId  === 'string' ? req.body.sessionId : null
  const sourceUrl = typeof req.body?.source_url === 'string' ? req.body.source_url
                  : typeof req.body?.sourceUrl  === 'string' ? req.body.sourceUrl : null
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })
  if (!sourceUrl) return res.status(400).json({ error: 'source_url required' })

  const validation = validateMediaUrl(sourceUrl)
  if (!validation.ok) {
    return res.status(400).json({ error: validation.userMessage, error_code: validation.errorCode })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Insert transcript_jobs row. Its UUID becomes the job_id n8n echoes
  // back in the callback. status='pending' lets the UI's Realtime
  // subscription render a "preparing" state immediately.
  const { data: job, error: jobErr } = await sb
    .schema('srp_pipeline')
    .from('transcript_jobs')
    .insert({
      session_id: sessionId,
      source_url: validation.normalizedUrl,
      source_type: validation.sourceType,
      status: 'pending',
      progress_percent: 0,
    })
    .select('id')
    .single()
  if (jobErr || !job) {
    return res.status(500).json({ error: `Failed to create transcript job: ${jobErr?.message ?? 'unknown'}` })
  }
  const jobId = job.id as string

  // Stamp the parent session with the job id + normalized video info so
  // the UI can read it back from sessions even if Realtime isn't connected.
  await sb
    .schema('srp_pipeline')
    .from('sessions')
    .update({
      transcript_job_id: jobId,
      video_url:         validation.normalizedUrl,
      video_source_type: validation.sourceType,
      transcript:        null,  // clear stale transcript on re-run
    })
    .eq('session_id', sessionId)

  // Build callback URL from the request's host. Lets the same code
  // serve prod, preview, and localhost without env config.
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string)
  const baseUrl = host
    ? `${proto}://${host}`
    : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  const payload = {
    job_id:          jobId,
    session_id:      sessionId,
    source_url:      validation.normalizedUrl,
    source_type:     validation.sourceType,
    callback_url:    `${baseUrl}/api/srp/transcription-callback`,
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
      console.error(`[start-transcription] n8n webhook returned ${r.status}: ${text.slice(0, 300)}`)
      // Mark the job failed so the UI can surface it. n8n won't be
      // calling back since the trigger didn't take.
      await sb
        .schema('srp_pipeline')
        .from('transcript_jobs')
        .update({
          status: 'failed',
          error_message: `n8n webhook returned ${r.status}: ${text.slice(0, 300)}`,
        })
        .eq('id', jobId)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    if (msg.includes('aborted') || msg.includes('TimeoutError')) {
      // n8n acknowledged but didn't respond fast enough — workflow is
      // still queued and will call us back. Treat as accepted.
      webhookOk = true
      console.warn(`[start-transcription] webhook timed out (n8n still running)`)
    } else {
      await sb
        .schema('srp_pipeline')
        .from('transcript_jobs')
        .update({ status: 'failed', error_message: `webhook fetch failed: ${msg}` })
        .eq('id', jobId)
      return res.status(502).json({ error: `n8n webhook failed: ${msg}`, job_id: jobId })
    }
  }

  return res.status(200).json({
    job_id:         jobId,
    session_id:     sessionId,
    source_type:    validation.sourceType,
    normalized_url: validation.normalizedUrl,
    status:         'pending',
    webhook_status: webhookOk ? 'accepted' : 'failed',
  })
}
