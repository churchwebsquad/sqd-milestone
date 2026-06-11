/**
 * Vercel Serverless Function — /api/srp/transcription-callback
 *
 * Receives status updates and final transcript from the n8n workflow.
 * Updates srp_pipeline.transcript_jobs by job_id. On terminal status,
 * also mirrors the transcript onto srp_pipeline.sessions so the UI's
 * step-3 components don't have to cross-join.
 *
 * Auth: callback_secret in Authorization: Bearer header OR body field.
 *
 * Expected body:
 *   {
 *     job_id,           (UUID of the transcript_jobs row — REQUIRED)
 *     callback_secret,  (or via Authorization: Bearer header)
 *     status,           ('pending'|'in_progress'|'completed'|'failed')
 *     status_message?,
 *     progress_percent?,
 *     transcript?,
 *     words?,           ([{word, start, end, confidence}])
 *     duration_seconds?,
 *     transcription_engine?,
 *     error_message?
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
  if ((bearerSecret || bodySecret) !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const jobId  = typeof req.body?.job_id === 'string' ? req.body.job_id : null
  const status = typeof req.body?.status === 'string' ? req.body.status : null
  if (!jobId)  return res.status(400).json({ error: 'job_id required' })
  if (!status) return res.status(400).json({ error: 'status required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Look up the job. session_id is needed to mirror onto sessions on completion.
  const { data: job, error: lookupErr } = await sb
    .schema('srp_pipeline')
    .from('transcript_jobs')
    .select('id, session_id, status')
    .eq('id', jobId)
    .maybeSingle()
  if (lookupErr) return res.status(500).json({ error: `Lookup failed: ${lookupErr.message}` })
  if (!job)      return res.status(404).json({ error: `Job not found: ${jobId}` })

  // Build partial update — only set fields the callback actually provided.
  const jobUpdate: Record<string, unknown> = { status }
  if (req.body?.status_message       !== undefined) jobUpdate.status_message       = req.body.status_message
  if (req.body?.progress_percent     !== undefined) jobUpdate.progress_percent     = req.body.progress_percent
  if (req.body?.transcript           !== undefined) jobUpdate.transcript           = req.body.transcript
  if (req.body?.words                !== undefined) jobUpdate.words                = req.body.words
  if (req.body?.duration_seconds     !== undefined) jobUpdate.duration_seconds     = req.body.duration_seconds
  if (req.body?.transcription_engine !== undefined) jobUpdate.transcription_engine = req.body.transcription_engine
  if (req.body?.error_message        !== undefined) jobUpdate.error_message        = req.body.error_message

  if (status === 'completed' || status === 'failed') {
    jobUpdate.completed_at    = new Date().toISOString()
    jobUpdate.progress_percent = status === 'completed' ? 100 : (jobUpdate.progress_percent ?? 0)
  }

  const { error: updateErr } = await sb
    .schema('srp_pipeline')
    .from('transcript_jobs')
    .update(jobUpdate)
    .eq('id', jobId)
  if (updateErr) return res.status(500).json({ error: `Failed to update job: ${updateErr.message}` })

  // On completion, mirror transcript + words onto the parent session.
  if (status === 'completed' && job.session_id) {
    const sessionUpdate: Record<string, unknown> = {}
    if (req.body?.transcript !== undefined) sessionUpdate.transcript       = req.body.transcript
    if (req.body?.words      !== undefined) sessionUpdate.transcript_words = req.body.words
    if (Object.keys(sessionUpdate).length > 0) {
      const { error: sessErr } = await sb
        .schema('srp_pipeline')
        .from('sessions')
        .update(sessionUpdate)
        .eq('session_id', job.session_id)
      if (sessErr) console.error(`[transcription-callback] failed to mirror onto sessions: ${sessErr.message}`)
    }
  }

  return res.status(200).json({ ok: true, job_id: jobId, status })
}
