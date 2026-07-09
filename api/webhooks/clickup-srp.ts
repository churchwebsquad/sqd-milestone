/**
 * POST /api/webhooks/clickup-srp
 *
 * Receives ClickUp webhook events for the sms-sermon-recap tag.
 * When a task gets that tag, we:
 *   1. Parse the task description for "External Link for Sermon Video:"
 *   2. If not found, check comments for the 🎥 upload comment
 *   3. Create an SRP session + kick off transcription automatically
 *   4. Track status in strategy_srp_auto_jobs so the Social Hub shows a badge
 *
 * ClickUp webhook verification:
 *   Header: X-Signature = HMAC-SHA256(body, CLICKUP_SRP_WEBHOOK_SECRET)
 *
 * Env vars required:
 *   CLICKUP_SRP_WEBHOOK_SECRET   — secret set when registering the webhook
 *   CLICKUP_MILESTONE_API_TOKEN  — ClickUp API token for fetching task details
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const maxDuration = 30

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekStart(now: Date): string {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  // Fri–Thu work week. getDay(): 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  const daysSinceFri = d.getDay() === 5 ? 0 : d.getDay() === 6 ? 1 : d.getDay() + 2
  d.setDate(d.getDate() - daysSinceFri)
  return d.toISOString().split('T')[0] // YYYY-MM-DD
}

function parseSermonVideoUrl(description: string): { url: string | null; waitingForUpload: boolean } {
  const lines = description.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // "We'll add the link to the Client Assets here in a while." → video uploading
    if (/we'?ll add the link to the client assets/i.test(trimmed)) {
      return { url: null, waitingForUpload: true }
    }

    // "External Link for Sermon Video: https://..."
    if (/^external\s+link\s+for\s+sermon\s+video[:\s]/i.test(trimmed)) {
      const urlMatch = trimmed.match(/https?:\/\/\S+/)
      if (urlMatch) return { url: urlMatch[0].replace(/[.,;)]+$/, ''), waitingForUpload: false }
    }
  }

  return { url: null, waitingForUpload: false }
}

function parseVideoUrlFromComment(commentText: string): string | null {
  // "🎥 Click here to view the uploaded video file: <url>"
  if (!/🎥/u.test(commentText)) return null
  const urlMatch = commentText.match(/https?:\/\/\S+/)
  return urlMatch ? urlMatch[0].replace(/[.,;)]+$/, '') : null
}

async function fetchTaskAndVideo(taskId: string, token: string): Promise<{
  description: string
  memberNumber: number | null
  videoUrl: string | null
  waitingForUpload: boolean
}> {
  const [taskRes, commentsRes] = await Promise.all([
    fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
      headers: { Authorization: token },
    }),
    fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, {
      headers: { Authorization: token },
    }),
  ])

  if (!taskRes.ok) throw new Error(`ClickUp task fetch failed: ${taskRes.status}`)
  const task = await taskRes.json()
  const description = task.description ?? ''

  // Extract member number from task name (format: "1234 - Church Name")
  const nameMatch = String(task.name ?? '').match(/^(\d+)\s*-/)
  const memberNumber = nameMatch ? parseInt(nameMatch[1], 10) : null

  // Check description first
  const { url: descUrl, waitingForUpload } = parseSermonVideoUrl(description)
  if (descUrl) return { description, memberNumber, videoUrl: descUrl, waitingForUpload: false }

  // If waiting for upload, scan comments for the 🎥 message
  if (waitingForUpload && commentsRes.ok) {
    const commentsData = await commentsRes.json()
    const comments: any[] = commentsData.comments ?? []
    for (const comment of comments) {
      const videoUrl = parseVideoUrlFromComment(comment.comment_text ?? '')
      if (videoUrl) return { description, memberNumber, videoUrl, waitingForUpload: false }
    }
    return { description, memberNumber, videoUrl: null, waitingForUpload: true }
  }

  return { description, memberNumber, videoUrl: null, waitingForUpload: false }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const webhookSecret  = process.env.CLICKUP_SRP_WEBHOOK_SECRET
  const clickupToken   = process.env.CLICKUP_MILESTONE_API_TOKEN
  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const missing = [
    !clickupToken   && 'CLICKUP_MILESTONE_API_TOKEN',
    !supabaseUrl    && 'VITE_SUPABASE_URL',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean)
  if (missing.length) return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}` })

  // ── Verify ClickUp signature ─────────────────────────────────────────
  if (webhookSecret) {
    const signature = req.headers['x-signature'] as string | undefined
    if (!signature) return res.status(401).json({ error: 'Missing X-Signature header' })
    const body = JSON.stringify(req.body)
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Invalid signature' })
    }
  }

  const event     = req.body
  const eventName = event?.event as string | undefined
  const taskId    = event?.task_id as string | undefined

  if (!taskId) return res.status(200).json({ ok: true, ignored: 'no task_id' })

  const sb = createClient(supabaseUrl!, serviceRoleKey!, { auth: { persistSession: false } })

  // ── Handle comment posted — check for 🎥 upload comment ─────────────
  if (eventName === 'taskCommentPosted') {
    const commentText: string = event?.comment?.text_content ?? event?.comment?.comment_text ?? ''
    const videoUrl = parseVideoUrlFromComment(commentText)
    if (!videoUrl) return res.status(200).json({ ok: true, ignored: 'not a video upload comment' })

    // Find an auto-job for this task that is waiting for video
    const { data: job } = await (sb as any)
      .schema('strategy').from('srp_auto_jobs')
      .select('id, member, session_id')
      .eq('clickup_task_id', taskId)
      .eq('video_status', 'waiting_for_upload')
      .single()

    if (!job) return res.status(200).json({ ok: true, ignored: 'no waiting auto-job for this task' })

    // Update the auto-job with the video URL
    await (sb as any).schema('strategy').from('srp_auto_jobs').update({
      video_url:         videoUrl,
      video_status:      'found',
      transcript_status: 'in_progress',
    }).eq('id', job.id)

    // Create a session if one doesn't exist yet
    let sessionId = job.session_id
    if (!sessionId) {
      const { data: session } = await sb
        .schema('srp_pipeline')
        .from('sessions')
        .insert({ member: job.member, source: 'auto', video_url: videoUrl, status: 'transcribing' })
        .select('session_id')
        .single()
      sessionId = session?.session_id ?? null
      if (sessionId) {
        await (sb as any).schema('strategy').from('srp_auto_jobs').update({ session_id: sessionId }).eq('id', job.id)
      }
    }

    // Fire transcription
    if (sessionId) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/srp-start-transcription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': process.env.VITE_SUPABASE_ANON_KEY ?? '' },
          body: JSON.stringify({ session_id: sessionId, source_url: videoUrl, source_type: 'unknown' }),
          signal: AbortSignal.timeout(20_000),
        })
      } catch (e) {
        console.warn('[clickup-srp] comment transcription fire error:', e instanceof Error ? e.message : e)
        await (sb as any).schema('strategy').from('srp_auto_jobs').update({
          transcript_status: 'error',
          video_error: `Transcription failed to start: ${e instanceof Error ? e.message : 'unknown'}`,
        }).eq('id', job.id)
      }
    }

    return res.status(200).json({ ok: true, member: job.member, video_url: videoUrl, transcript_status: 'in_progress' })
  }

  // We only care about tag events for sms-sermon-recap
  const isTagEvent = eventName === 'taskTagUpdated' || eventName === 'taskCreated' || eventName === 'taskUpdated'
  if (!isTagEvent) return res.status(200).json({ ok: true, ignored: `event: ${eventName}` })

  const addedTags: string[] = event?.history_items
    ?.filter((h: any) => h.field === 'tag' && h.after)
    ?.map((h: any) => h.after as string) ?? []

  const hasSrpTag =
    addedTags.some(t => t.toLowerCase() === 'sms-sermon-recap') ||
    (event?.tags ?? []).some((t: any) =>
      (typeof t === 'string' ? t : t?.name ?? '').toLowerCase() === 'sms-sermon-recap'
    )

  if (!hasSrpTag) return res.status(200).json({ ok: true, ignored: 'sms-sermon-recap tag not present' })

  const weekStart = getWeekStart(new Date())

  // ── Fetch task + find video ──────────────────────────────────────────
  let memberNumber: number | null = null
  let videoUrl: string | null = null
  let waitingForUpload = false
  let fetchError: string | null = null

  try {
    const result = await fetchTaskAndVideo(taskId, clickupToken!)
    memberNumber     = result.memberNumber
    videoUrl         = result.videoUrl
    waitingForUpload = result.waitingForUpload
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'Failed to fetch task'
  }

  if (!memberNumber) {
    return res.status(200).json({ ok: true, ignored: 'could not parse member number from task name' })
  }

  const videoStatus = fetchError
    ? 'error'
    : videoUrl
    ? 'found'
    : waitingForUpload
    ? 'waiting_for_upload'
    : 'error'

  // ── Upsert auto-job row ──────────────────────────────────────────────
  const { data: autoJob, error: upsertErr } = await sb
    .schema('strategy').from('srp_auto_jobs')
    .upsert({
      member:           memberNumber,
      clickup_task_id:  taskId,
      week_start:       weekStart,
      video_url:        videoUrl,
      video_status:     videoStatus,
      video_error:      fetchError ?? (videoStatus === 'error' ? 'No video link found in task description' : null),
      transcript_status: videoUrl ? 'pending' : 'skipped',
    }, { onConflict: 'member,week_start' })
    .select('id, session_id')
    .single()

  if (upsertErr) {
    console.error('[clickup-srp] upsert error:', upsertErr.message)
    return res.status(500).json({ error: upsertErr.message })
  }

  // ── Kick off transcription if we have a video URL ────────────────────
  if (videoUrl && autoJob) {
    // Create an SRP session to attach the transcript job to
    const { data: session, error: sessionErr } = await sb
      .schema('srp_pipeline')
      .from('sessions')
      .insert({
        member:      memberNumber,
        source:      'auto',
        video_url:   videoUrl,
        status:      'transcribing',
      })
      .select('session_id')
      .single()

    if (sessionErr || !session) {
      console.error('[clickup-srp] session create error:', sessionErr?.message)
      // Update auto-job with error but still return 200 so ClickUp doesn't retry
      await sb.schema('strategy').from('srp_auto_jobs').update({
        transcript_status: 'error',
        video_error: `Failed to create SRP session: ${sessionErr?.message}`,
      }).eq('id', autoJob.id)
      return res.status(200).json({ ok: true, member: memberNumber, video_status: videoStatus, transcript_status: 'error' })
    }

    // Store session_id on the auto-job
    await sb.schema('strategy').from('srp_auto_jobs').update({
      session_id:        session.session_id,
      transcript_status: 'in_progress',
    }).eq('id', autoJob.id)

    // Call Duane's start-transcription edge function
    const supabaseFnUrl = `${supabaseUrl}/functions/v1/srp-start-transcription`
    try {
      await fetch(supabaseFnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.VITE_SUPABASE_ANON_KEY ?? '',
        },
        body: JSON.stringify({
          session_id:  session.session_id,
          source_url:  videoUrl,
          source_type: 'unknown',
        }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (e) {
      console.warn('[clickup-srp] transcription fire error:', e instanceof Error ? e.message : e)
      await sb.schema('strategy').from('srp_auto_jobs').update({
        transcript_status: 'error',
        video_error: `Transcription failed to start: ${e instanceof Error ? e.message : 'unknown'}`,
      }).eq('id', autoJob.id)
    }
  }

  return res.status(200).json({
    ok:                true,
    member:            memberNumber,
    task_id:           taskId,
    video_status:      videoStatus,
    video_url:         videoUrl,
    transcript_status: videoUrl ? 'in_progress' : 'skipped',
  })
}
