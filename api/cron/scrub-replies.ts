/**
 * Vercel Serverless Cron — /api/cron/scrub-replies
 *
 * Runs weekdays at 3 PM ET (19:00 UTC) via vercel.json cron.
 *
 * For each active submission uses:
 *   GET /api/v3/workspaces/{teamId}/chat/messages/{messageId}/replies
 * which returns only thread replies to the specific milestone message —
 * not other channel activity.
 *
 * Author identity is resolved via the clickup_users table.
 * employee IS NOT NULL → staff.  employee IS NULL / not found → partner.
 *
 * Security: verifies Authorization: Bearer <CRON_SECRET> header.
 * DB access: uses SUPABASE_SERVICE_ROLE_KEY — bypasses RLS.
 */

import { createClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActiveSubmission {
  id: string
  clickup_channel_id: string
  clickup_message_id: string
  milestone_status: string
}

interface V3Reply {
  id: string | number
  content?: string
  user_id?: string | number
  date?: number
  date_assigned?: number
  parent_message?: string
}

interface V3RepliesResponse {
  data?: V3Reply[]
  next_cursor?: string
}

interface ClickUpUserRow {
  clickup_id: number
  username: string | null
  email: string | null
  employee: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Fetch all pages of thread replies for a message. */
async function fetchAllReplies(
  teamId: string,
  messageId: string,
  token: string,
): Promise<V3Reply[]> {
  const all: V3Reply[] = []
  let cursor = ''

  do {
    const url = new URL(
      `https://api.clickup.com/api/v3/workspaces/${teamId}/chat/messages/${messageId}/replies`,
    )
    if (cursor) url.searchParams.set('cursor', cursor)

    const res = await fetch(url.toString(), { headers: { Authorization: token } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`ClickUp ${res.status}: ${text}`)
    }

    const body = (await res.json()) as V3RepliesResponse
    all.push(...(body.data ?? []))
    cursor = body.next_cursor ?? ''
  } while (cursor)

  return all
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: { method: string; headers: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void }
    json: (body: unknown) => void
  },
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret  = process.env.CRON_SECRET
  const authHeader  = Array.isArray(req.headers['authorization'])
    ? req.headers['authorization'][0]
    : req.headers['authorization']

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clickupToken   = process.env.CLICKUP_MILESTONE_API_TOKEN

  if (!supabaseUrl || !serviceRoleKey || !clickupToken) {
    return res.status(500).json({ error: 'Missing required environment variables' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // ── Fetch team ID (needed for v3 workspace-scoped endpoint) ───────────────
  let teamId: string | null = null
  try {
    const teamRes = await fetch('https://api.clickup.com/api/v2/team', {
      headers: { Authorization: clickupToken },
    })
    const teamBody = await teamRes.json() as { teams?: Array<{ id: string }> }
    teamId = teamBody.teams?.[0]?.id ?? null
  } catch { /* leave null — caught per-submission below */ }

  if (!teamId) {
    return res.status(500).json({ error: 'Could not resolve ClickUp team ID' })
  }

  // ── Fetch active submissions ───────────────────────────────────────────────
  const { data: subData, error: fetchErr } = await supabase
    .from('strategy_milestone_submissions')
    .select('id, clickup_channel_id, clickup_message_id, milestone_status')
    .in('milestone_status', ['sent', 'waiting_on_partner'])
    .not('clickup_channel_id', 'is', null)
    .not('clickup_message_id', 'is', null)

  if (fetchErr) {
    console.error('[scrub-replies] fetch error:', fetchErr.message)
    return res.status(500).json({ error: fetchErr.message })
  }

  const active = (subData ?? []) as ActiveSubmission[]
  console.log(`[scrub-replies] processing ${active.length} submissions`)

  let repliesInserted = 0
  let statusesUpdated = 0
  let errors = 0

  for (const sub of active) {
    try {
      // ── Fetch thread replies for this specific message ───────────────────
      const replies = await fetchAllReplies(teamId, sub.clickup_message_id, clickupToken)

      if (replies.length === 0) {
        await delay(200)
        continue
      }

      // ── Resolve author details from clickup_users ────────────────────────
      const userIds = [...new Set(replies.map(r => Number(r.user_id)).filter(Boolean))]
      const { data: userRows } = await supabase
        .from('clickup_users')
        .select('clickup_id, username, email, employee')
        .in('clickup_id', userIds)

      const userMap = new Map<number, ClickUpUserRow>()
      for (const u of (userRows ?? []) as ClickUpUserRow[]) {
        userMap.set(u.clickup_id, u)
      }

      // ── Load existing stored reply IDs to skip duplicates ────────────────
      const { data: existingRows } = await supabase
        .from('strategy_milestone_replies')
        .select('clickup_reply_id')
        .eq('submission_id', sub.id)
        .not('clickup_reply_id', 'is', null)

      const existingIds = new Set<string>(
        (existingRows ?? [])
          .map((r: { clickup_reply_id: string | null }) => r.clickup_reply_id)
          .filter((id): id is string => id !== null),
      )

      let hasNewPartnerReply = false

      for (const reply of replies) {
        const replyId = String(reply.id)
        if (existingIds.has(replyId)) continue

        const userId    = Number(reply.user_id)
        const userData  = userMap.get(userId)
        const authorName  = userData?.username ?? `User ${userId}`
        const authorEmail = userData?.email ?? null
        // Staff if: employee field is set OR email contains @churchmediasquad.com
        const isPartner   = !userData?.employee &&
          !userData?.email?.toLowerCase().includes('@churchmediasquad.com')

        const detectedAt = reply.date ?? reply.date_assigned
          ? new Date(reply.date ?? reply.date_assigned!).toISOString()
          : new Date().toISOString()

        const { error: insertErr } = await supabase
          .from('strategy_milestone_replies')
          .insert({
            submission_id:      sub.id,
            reply_text:         reply.content ?? '',
            reply_author_name:  authorName,
            reply_author_email: authorEmail,
            is_partner_reply:   isPartner,
            triage_category:    null,
            source:             'clickup_thread',
            detected_at:        detectedAt,
            clickup_reply_id:   replyId,
          })

        if (insertErr) {
          console.warn(`[scrub-replies] insert failed (sub ${sub.id}):`, insertErr.message)
        } else {
          repliesInserted++
          if (isPartner) hasNewPartnerReply = true
        }
      }

      // Advance to partner_replied only from sent / waiting_on_partner
      if (hasNewPartnerReply) {
        const { error: updateErr } = await supabase
          .from('strategy_milestone_submissions')
          .update({ milestone_status: 'partner_replied' })
          .eq('id', sub.id)
          .in('milestone_status', ['sent', 'waiting_on_partner'])

        if (!updateErr) statusesUpdated++
        else console.warn(`[scrub-replies] status update failed (sub ${sub.id}):`, updateErr.message)
      }
    } catch (err) {
      console.error(`[scrub-replies] error for sub ${sub.id}:`, err instanceof Error ? err.message : String(err))
      errors++
    }

    await delay(200)
  }

  const summary = { processed: active.length, replies_inserted: repliesInserted, statuses_updated: statusesUpdated, errors }
  console.log('[scrub-replies] done:', summary)
  return res.status(200).json(summary)
}
