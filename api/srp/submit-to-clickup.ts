/**
 * Vercel Serverless Function — /api/srp/submit-to-clickup
 *
 * Submits the final SRP deliverables (rendered clips + approved text
 * content + creative direction) to ClickUp via an n8n webhook. n8n
 * resolves the "SRP Video" child task via blocker-dependency on the
 * parent sermon task and posts clip videos as attachments + comments
 * with transcripts.
 *
 * If n8n can't find the blocker-dependent child task, the caller (UI)
 * can resubmit with srp_task_id_override set to manually target a task.
 *
 * Env:
 *   SRP_N8N_CLICKUP_WEBHOOK_URL — n8n webhook for clip-to-ClickUp flow
 *   SRP_N8N_CALLBACK_SECRET     — shared secret echoed in callback
 *
 *   POST { session_id, srp_task_id_override? }
 *   → 200 { ok, status, clickup_task_id? }
 *   → 422 { error_code: "no_blocker_dependency", details }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const webhookUrl     = process.env.SRP_N8N_CLICKUP_WEBHOOK_URL
  const callbackSecret = process.env.SRP_N8N_CALLBACK_SECRET
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })
  if (!webhookUrl)     return res.status(500).json({ error: 'SRP_N8N_CLICKUP_WEBHOOK_URL not configured' })
  if (!callbackSecret) return res.status(500).json({ error: 'SRP_N8N_CALLBACK_SECRET not configured' })

  const sessionId  = typeof req.body?.session_id === 'string' ? req.body.session_id
                   : typeof req.body?.sessionId  === 'string' ? req.body.sessionId : null
  const overrideId = typeof req.body?.srp_task_id_override === 'string' ? req.body.srp_task_id_override.trim() : null
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Read the full session + the latest clipcutter_jobs.clip_results.
  const { data: session, error: sessErr } = await sb
    .schema('srp_pipeline')
    .from('sessions')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (sessErr || !session) return res.status(404).json({ error: sessErr?.message ?? 'Session not found' })
  if (!session.clickup_task_id) return res.status(400).json({ error: 'No clickup_task_id on session — set it before submitting.' })

  const { data: clipJob } = session.clipcutter_job_id
    ? await sb
        .schema('srp_pipeline')
        .from('clipcutter_jobs')
        .select('clips, clip_results, status')
        .eq('id', session.clipcutter_job_id)
        .maybeSingle()
    : { data: null }

  // Build the clips payload. Each entry combines the originally requested
  // clip with its rendered output (video_url / srt_url) from the cutter.
  const requestedClips = Array.isArray(clipJob?.clips) ? clipJob.clips as any[] : []
  const renderedById = new Map<string, any>()
  for (const r of (Array.isArray(clipJob?.clip_results) ? clipJob.clip_results as any[] : [])) {
    if (r?.clip_id != null) renderedById.set(String(r.clip_id), r)
  }
  const clipsPayload = requestedClips
    .map((c: any) => {
      const r = renderedById.get(String(c.clip_id))
      return {
        clip_id:          String(c.clip_id),
        clip_name:        c.clip_name ?? c.category ?? `Clip ${c.clip_id}`,
        in_point_ms:      c.in_point_ms ?? 0,
        out_point_ms:     c.out_point_ms ?? 0,
        duration_seconds: typeof c.out_point_ms === 'number' && typeof c.in_point_ms === 'number'
                          ? Math.round((c.out_point_ms - c.in_point_ms) / 1000)
                          : null,
        quote:            c.quote ?? null,
        category:         c.category ?? null,
        video_url:        r?.video_url ?? null,
        srt_url:          r?.srt_url ?? null,
        transcript:       c.quote ?? null,
        srt_transcript:   r?.srt_content ?? null,
      }
    })

  // Approved content: the final text deliverables the coach accepted.
  const approved_content = {
    reel1_caption:       session.reel1_caption,
    reel2_caption:       session.reel2_caption,
    carousel_slides:     session.carousel_slides,
    carousel_caption:    session.carousel_caption,
    facebook_post:       session.facebook_post,
    sunday_invite:       session.sunday_invite,
    photo_recap_caption: session.photo_recap_caption,
  }

  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string)
  const baseUrl = host
    ? `${proto}://${host}`
    : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  // Mark session as submitting.
  await sb
    .schema('srp_pipeline')
    .from('sessions')
    .update({ status: 'submitting', srp_task_id_override: overrideId ?? null })
    .eq('session_id', sessionId)

  const payload = {
    session_id:       sessionId,
    clickup_id:       session.clickup_task_id,
    srp_task_id_override: overrideId ?? null,
    clips:            clipsPayload,
    creative_direction: {
      srp_template:     session.srp_template,
      background_music: session.background_music,
      designer_notes:   session.designer_notes,
    },
    approved_content,
    callback_url:    `${baseUrl}/api/srp/submit-to-clickup-callback`,
    callback_secret: callbackSecret,
  }

  let webhookOk = false
  let webhookBody: any = null
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
    webhookOk = r.ok
    try { webhookBody = await r.json() } catch { webhookBody = null }
    if (!r.ok) {
      console.error(`[submit-to-clickup] n8n webhook ${r.status}: ${JSON.stringify(webhookBody).slice(0, 300)}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    if (msg.includes('aborted') || msg.includes('TimeoutError')) {
      webhookOk = true
      console.warn(`[submit-to-clickup] webhook timed out (n8n still running)`)
    } else {
      await sb
        .schema('srp_pipeline')
        .from('sessions')
        .update({ status: 'submit_failed' })
        .eq('session_id', sessionId)
      return res.status(502).json({ error: `n8n webhook failed: ${msg}` })
    }
  }

  // n8n surfaces blocker-dependency resolution failures inline so the UI
  // can prompt the coach for a manual srp_task_id_override.
  if (webhookBody?.error_code === 'no_blocker_dependency') {
    await sb
      .schema('srp_pipeline')
      .from('sessions')
      .update({ status: 'submit_failed' })
      .eq('session_id', sessionId)
    return res.status(422).json({
      error_code: 'no_blocker_dependency',
      details: webhookBody?.message ?? 'n8n could not resolve the SRP Video child task. Provide srp_task_id_override.',
    })
  }

  if (!webhookOk) {
    await sb
      .schema('srp_pipeline')
      .from('sessions')
      .update({ status: 'submit_failed' })
      .eq('session_id', sessionId)
    return res.status(502).json({ error: 'ClickUp submission failed at n8n.', details: webhookBody })
  }

  return res.status(200).json({
    ok: true,
    status: 'submitted',
    clickup_task_id: session.clickup_task_id,
    clip_count: clipsPayload.length,
  })
}
