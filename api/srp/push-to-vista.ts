/**
 * Vercel Serverless Function — /api/srp/push-to-vista
 *
 * Scaffold for direct push to Vista Social. Requires three env vars
 * that aren't configured yet — until they're set, returns a structured
 * 503 telling the UI to fall back to the CSV download.
 *
 *   VISTA_API_BASE_URL    — Vista's REST root
 *   VISTA_API_TOKEN       — bearer token
 *   VISTA_TEAM_ID         — team identifier (may be required)
 *
 * Once configured, pushes each approved deliverable as a draft post to
 * the church's connected Vista profile (one profile per platform from
 * public.sms_vista_social, keyed by `account` = member number).
 *
 *   POST { session_id }
 *   → 200 { ok, pushed, failed, results }
 *   → 503 { error, fallback: "use CSV download" }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

interface DeliverableJob {
  kind: 'facebook_post' | 'sunday_invite' | 'photo_recap' | 'carousel_caption' | 'reel1_caption' | 'reel2_caption'
  platforms: Array<'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'twitter'>
  text: string
  media_urls?: string[]
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const vistaBase  = process.env.VISTA_API_BASE_URL
  const vistaToken = process.env.VISTA_API_TOKEN
  const vistaTeam  = process.env.VISTA_TEAM_ID
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  if (!vistaBase || !vistaToken) {
    return res.status(503).json({
      error: 'Vista direct push not configured',
      reason: 'VISTA_API_BASE_URL and VISTA_API_TOKEN must be set in Vercel env vars',
      fallback: 'Use the CSV download — it produces a file the team can manually import into Vista Social.',
      missing_env_vars: [
        !vistaBase  ? 'VISTA_API_BASE_URL'  : null,
        !vistaToken ? 'VISTA_API_TOKEN'     : null,
        !vistaTeam  ? 'VISTA_TEAM_ID (may not be required, fill if Vista API requires team scoping)' : null,
      ].filter(Boolean),
    })
  }

  const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id
                  : typeof req.body?.sessionId  === 'string' ? req.body.sessionId : null
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: session, error: sessErr } = await sb
    .schema('srp_pipeline')
    .from('sessions')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (sessErr || !session) return res.status(404).json({ error: sessErr?.message ?? 'Session not found' })

  const memberNum = parseInt(String(session.member ?? ''), 10)
  if (!Number.isFinite(memberNum)) {
    return res.status(400).json({ error: 'Session has no member — cannot route to Vista profile.' })
  }

  // Look up connected Vista profiles for this church.
  const { data: profiles } = await sb
    .from('sms_vista_social')
    .select('platform, username, status, link')
    .eq('account', memberNum)
  const connectedProfiles = (profiles ?? []).filter((p: any) => (p.status ?? '').toLowerCase() === 'connected')
  if (connectedProfiles.length === 0) {
    return res.status(400).json({
      error: 'No connected Vista profiles for this church',
      member: memberNum,
      hint: 'Check sms_vista_social rows for this account — status must be "connected".',
    })
  }

  // Build per-deliverable job list.
  const jobs: DeliverableJob[] = []
  if (session.facebook_post)       jobs.push({ kind: 'facebook_post',    platforms: ['facebook'],                text: session.facebook_post })
  if (session.sunday_invite)       jobs.push({ kind: 'sunday_invite',    platforms: ['facebook', 'instagram'],   text: session.sunday_invite })
  if (session.photo_recap_caption) jobs.push({ kind: 'photo_recap',      platforms: ['instagram', 'facebook'],   text: session.photo_recap_caption })
  if (session.carousel_caption)    jobs.push({ kind: 'carousel_caption', platforms: ['instagram'],               text: session.carousel_caption })

  // Reels — pull rendered MP4 URLs from clipcutter_jobs.clip_results if available.
  let renderedUrls: string[] = []
  if (session.clipcutter_job_id) {
    const { data: clipJob } = await sb
      .schema('srp_pipeline')
      .from('clipcutter_jobs')
      .select('clip_results')
      .eq('id', session.clipcutter_job_id)
      .maybeSingle()
    const results = Array.isArray(clipJob?.clip_results) ? clipJob.clip_results as any[] : []
    renderedUrls = results.map((r: any) => r?.video_url).filter(Boolean)
  }
  if (session.reel1_caption) {
    jobs.push({
      kind: 'reel1_caption',
      platforms: ['instagram', 'tiktok'],
      text: session.reel1_caption,
      media_urls: renderedUrls[0] ? [renderedUrls[0]] : undefined,
    })
  }
  if (session.reel2_caption) {
    jobs.push({
      kind: 'reel2_caption',
      platforms: ['instagram', 'tiktok'],
      text: session.reel2_caption,
      media_urls: renderedUrls[1] ? [renderedUrls[1]] : undefined,
    })
  }

  if (jobs.length === 0) {
    return res.status(400).json({ error: 'No deliverables to push.' })
  }

  // ── Vista API call ─────────────────────────────────────────────────
  // PLACEHOLDER: exact endpoint + payload shape must be confirmed against
  // Vista Social's API docs. Failures surface verbatim so the contract
  // issue is debuggable.
  const results: Array<{ kind: string; platform: string; ok: boolean; detail?: any }> = []
  for (const job of jobs) {
    for (const platform of job.platforms) {
      const profile = connectedProfiles.find((p: any) => (p.platform ?? '').toLowerCase() === platform)
      if (!profile) {
        results.push({ kind: job.kind, platform, ok: false, detail: `No connected ${platform} profile for member ${memberNum}` })
        continue
      }
      try {
        const payload = {
          team_id:    vistaTeam,
          profile_id: profile.username,   // TODO: confirm Vista's profile identifier (id vs username)
          status:     'draft',            // ship as draft so the team reviews before publishing
          text:       job.text,
          media_urls: job.media_urls ?? [],
          platform,
          source:     'srp_generator',
          session_id: sessionId,
        }
        const r = await fetch(`${vistaBase.replace(/\/$/, '')}/posts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${vistaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        const body = await r.text()
        results.push({ kind: job.kind, platform, ok: r.ok, detail: body.slice(0, 300) })
      } catch (e) {
        results.push({ kind: job.kind, platform, ok: false, detail: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  return res.status(200).json({
    ok: true,
    pushed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  })
}
