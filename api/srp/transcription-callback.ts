/**
 * Vercel Serverless Function — /api/srp/transcription-callback
 *
 * Receives the completed transcript from the n8n workflow and writes
 * it to sms_srp_generation.transcript. Auth via SRP_N8N_CALLBACK_SECRET
 * (Authorization: Bearer or body field — matches reference convention).
 *
 * Expected body shape:
 *   {
 *     job_id, session_id, callback_secret,
 *     status: 'completed' | 'failed' | 'processing',
 *     transcript: string,
 *     words?: [{word, start, end, confidence}],     // optional timing
 *     duration_seconds?: number,
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

  // Auth: accept secret from Authorization: Bearer header OR body field
  const authHeader = (req.headers.authorization ?? req.headers.Authorization ?? '') as string
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const bodySecret = typeof req.body?.callback_secret === 'string' ? req.body.callback_secret : ''
  const providedSecret = bearerSecret || bodySecret
  if (providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id : null
  const status = typeof req.body?.status === 'string' ? req.body.status : 'completed'
  const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const errorMessage = typeof req.body?.error_message === 'string' ? req.body.error_message : null

  if (!sessionId) return res.status(400).json({ error: 'session_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  if (status === 'failed') {
    // Surface failures by writing a sentinel into the transcript field
    // so the polling UI knows the run failed. Cleared on next attempt.
    const sentinel = `__TRANSCRIPTION_FAILED__\n${errorMessage ?? 'Unknown error'}`
    await sb.from('sms_srp_generation')
      .update({ transcript: sentinel, updated_at: new Date().toISOString() })
      .eq('session_id', sessionId)
    return res.status(200).json({ ok: true, status: 'failed', recorded: true })
  }

  if (status === 'processing') {
    // n8n sometimes pings intermediate progress. Don't touch the
    // transcript column — that's reserved for the final result.
    return res.status(200).json({ ok: true, status: 'processing', noop: true })
  }

  if (!transcript || transcript.trim().length < 10) {
    return res.status(400).json({ error: 'transcript missing or too short' })
  }

  const { error: writeErr } = await sb.from('sms_srp_generation')
    .update({ transcript, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, status: 'completed', session_id: sessionId })
}
