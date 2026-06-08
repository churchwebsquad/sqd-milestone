/**
 * Vercel Serverless Function — /api/srp/submit-to-clickup
 *
 * Posts the SRP deliverables as a comment on a ClickUp task. Lighter
 * scope than the reference (which uploads clip videos) — this is text
 * deliverables only, since clipcutter is out of scope.
 *
 * Inputs:
 *   sessionId — required
 *   clickupTaskId — required (the team picks/types it in the UI)
 *
 * The endpoint reads the latest deliverable text from sms_srp_generation
 * directly so the comment always reflects the saved values, not stale
 * client state.
 *
 * Auth: CLICKUP_MILESTONE_API_TOKEN env (same token the
 * clickup-chat-message webhook uses).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

const CLICKUP_API = 'https://api.clickup.com/api/v2'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clickupToken   = process.env.CLICKUP_MILESTONE_API_TOKEN
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })
  if (!clickupToken) return res.status(500).json({ error: 'CLICKUP_MILESTONE_API_TOKEN not configured' })

  const sessionId     = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null
  const clickupTaskId = typeof req.body?.clickupTaskId === 'string' ? req.body.clickupTaskId.trim() : null
  if (!sessionId)     return res.status(400).json({ error: 'sessionId required' })
  if (!clickupTaskId) return res.status(400).json({ error: 'clickupTaskId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const { data: session, error: sessErr } = await sb
    .from('sms_srp_generation')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (sessErr || !session) return res.status(404).json({ error: sessErr?.message ?? 'Session not found' })

  const body = buildCommentBody(session)

  const r = await fetch(`${CLICKUP_API}/task/${encodeURIComponent(clickupTaskId)}/comment`, {
    method: 'POST',
    headers: {
      Authorization: clickupToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      comment_text: body,
      notify_all: false,
    }),
  })

  if (!r.ok) {
    const text = await r.text()
    return res.status(502).json({ error: `ClickUp ${r.status}: ${text.slice(0, 400)}` })
  }

  const responseData = await r.json().catch(() => ({}))
  const commentId = (responseData as { id?: string })?.id ?? null

  await sb
    .from('sms_srp_generation')
    .update({
      clickup_task_id: clickupTaskId,
      clickup_url: `https://app.clickup.com/t/${clickupTaskId}`,
      updated_at: new Date().toISOString(),
    })
    .eq('session_id', sessionId)

  return res.status(200).json({ ok: true, comment_id: commentId, task_id: clickupTaskId })
}

function buildCommentBody(s: any): string {
  const parts: string[] = []
  parts.push(`SRP Deliverables — ${s.church_name ?? '—'}`)
  parts.push(`Session: ${s.session_id}`)
  parts.push('')

  if (s.facebook_post) {
    parts.push('---', '## Facebook Post', '', String(s.facebook_post))
  }
  if (s.sunday_invite) {
    parts.push('---', '## Sunday Invite', '', String(s.sunday_invite))
  }
  if (s.carousel_caption || s.carousel_slides) {
    parts.push('---', '## Carousel')
    if (s.carousel_caption) parts.push('', '**Caption:**', String(s.carousel_caption))
    if (s.carousel_slides) {
      try {
        const slides = JSON.parse(s.carousel_slides)
        if (Array.isArray(slides) && slides.length > 0) {
          parts.push('', '**Slides:**')
          slides.forEach((slide: any) => {
            parts.push(`${slide.slide_number ?? '?'}. [${slide.kind ?? ''}] ${slide.text ?? ''}`)
          })
        }
      } catch { /* skip on parse error */ }
    }
  }
  if (s.photo_recap_caption) {
    parts.push('---', '## Photo Recap', '', String(s.photo_recap_caption))
  }
  if (s.reel1_caption) {
    parts.push('---', '## Reel 1', '', String(s.reel1_caption))
  }
  if (s.reel2_caption) {
    parts.push('---', '## Reel 2', '', String(s.reel2_caption))
  }

  return parts.join('\n')
}
