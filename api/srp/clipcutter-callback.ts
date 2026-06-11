/**
 * Vercel Serverless Function — /api/srp/clipcutter-callback
 *
 * Receives status updates and final clip results from the n8n clipcutter
 * workflow. Updates srp_pipeline.clipcutter_jobs by job_id. On terminal
 * status, mirrors clip_processing_status onto srp_pipeline.sessions.
 *
 * Auth: callback_secret in Authorization: Bearer header OR body field.
 *
 * Expected body:
 *   {
 *     job_id,             (UUID of clipcutter_jobs row — REQUIRED)
 *     callback_secret,
 *     status,             ('pending'|'in_progress'|'completed'|'failed'|'partial')
 *     status_message?,
 *     progress_percent?,
 *     clip_results?,      [{ clip_id, video_url, srt_url?, status, error_message? }]
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

  // Look up the job.
  const { data: job, error: lookupErr } = await sb
    .schema('srp_pipeline')
    .from('clipcutter_jobs')
    .select('id, session_id, status')
    .eq('id', jobId)
    .maybeSingle()
  if (lookupErr) return res.status(500).json({ error: `Lookup failed: ${lookupErr.message}` })
  if (!job)      return res.status(404).json({ error: `Job not found: ${jobId}` })

  const jobUpdate: Record<string, unknown> = { status }
  if (req.body?.status_message   !== undefined) jobUpdate.status_message   = req.body.status_message
  if (req.body?.progress_percent !== undefined) jobUpdate.progress_percent = req.body.progress_percent
  if (req.body?.clip_results     !== undefined) jobUpdate.clip_results     = req.body.clip_results
  if (req.body?.error_message    !== undefined) jobUpdate.error_message    = req.body.error_message

  const isTerminal = status === 'completed' || status === 'failed' || status === 'partial'
  if (isTerminal) {
    jobUpdate.completed_at = new Date().toISOString()
    jobUpdate.progress_percent = status === 'completed' ? 100 : (jobUpdate.progress_percent ?? 0)
  }

  const { error: updateErr } = await sb
    .schema('srp_pipeline')
    .from('clipcutter_jobs')
    .update(jobUpdate)
    .eq('id', jobId)
  if (updateErr) return res.status(500).json({ error: `Failed to update job: ${updateErr.message}` })

  // Mirror terminal status onto the parent session.
  if (isTerminal && job.session_id) {
    await sb
      .schema('srp_pipeline')
      .from('sessions')
      .update({ clip_processing_status: status })
      .eq('session_id', job.session_id)
  }

  return res.status(200).json({
    ok: true,
    job_id: jobId,
    status,
    processed: Array.isArray(req.body?.clip_results) ? req.body.clip_results.length : 0,
  })
}
