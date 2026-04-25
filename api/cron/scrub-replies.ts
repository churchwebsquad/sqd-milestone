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
  is_continuation: boolean
  continuation_of: string | null
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
  // We pull `is_continuation` + `continuation_of` so we can group every
  // submission in a continuation chain together. ClickUp threads are
  // flat — replies to a continuation message live in the same thread as
  // the original — so we fetch replies once per root and route each
  // reply to the continuation submission whose message_id matches the
  // reply's `parent_message` field.
  const { data: subData, error: fetchErr } = await supabase
    .from('strategy_milestone_submissions')
    .select('id, clickup_channel_id, clickup_message_id, milestone_status, is_continuation, continuation_of')
    .in('milestone_status', ['sent', 'waiting_on_partner'])
    .not('clickup_channel_id', 'is', null)
    .not('clickup_message_id', 'is', null)

  if (fetchErr) {
    console.error('[scrub-replies] fetch error:', fetchErr.message)
    return res.status(500).json({ error: fetchErr.message })
  }

  const active = (subData ?? []) as ActiveSubmission[]

  // Resolve the root message_id for each chain. We need *all* submissions
  // in each chain (not just the active ones) to route replies correctly,
  // so pull the entire chain via `continuation_of` walks. For non-active
  // root submissions (status = verified/launched/etc.), we still want
  // their message_id for routing — but we won't update their status.
  const allSubs = new Map<string, ActiveSubmission>()
  for (const s of active) allSubs.set(s.id, s)

  // Walk continuation_of upward to find every parent submission.
  const parentIdsToFetch = new Set<string>()
  for (const s of active) {
    let cursor: string | null = s.continuation_of
    while (cursor && !allSubs.has(cursor) && !parentIdsToFetch.has(cursor)) {
      parentIdsToFetch.add(cursor)
      // We don't have the row yet to walk further — fetch in batch below.
      break
    }
  }
  if (parentIdsToFetch.size > 0) {
    const { data: parentRows } = await supabase
      .from('strategy_milestone_submissions')
      .select('id, clickup_channel_id, clickup_message_id, milestone_status, is_continuation, continuation_of')
      .in('id', [...parentIdsToFetch])
    for (const r of (parentRows ?? []) as ActiveSubmission[]) {
      if (r.clickup_message_id) allSubs.set(r.id, r)
      // We don't recursively walk further — for v1, one hop up is enough
      // for the typical 2- or 3-step continuation chain. Deep chains will
      // miss intermediate hops; revisit if needed.
    }
  }

  /** Walk to the root submission (non-continuation ancestor) and return
   *  every submission in the chain. */
  const findChain = (start: ActiveSubmission): ActiveSubmission[] => {
    const chain: ActiveSubmission[] = [start]
    let cursor: string | null = start.continuation_of
    const seen = new Set<string>([start.id])
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const parent = allSubs.get(cursor)
      if (!parent) break
      chain.unshift(parent)
      cursor = parent.continuation_of
    }
    return chain
  }

  // Group by root message id. The root is whichever submission in the
  // chain isn't a continuation (or the earliest one we have).
  const chainsByRoot = new Map<string, ActiveSubmission[]>()
  const rootForActive = new Map<string, string>() // active sub id → root message id
  const processedRoots = new Set<string>()
  for (const s of active) {
    const chain = findChain(s)
    const root = chain.find(c => !c.is_continuation) ?? chain[0]
    if (!root.clickup_message_id) continue
    rootForActive.set(s.id, root.clickup_message_id)
    if (!processedRoots.has(root.clickup_message_id)) {
      chainsByRoot.set(root.clickup_message_id, chain)
      processedRoots.add(root.clickup_message_id)
    }
  }

  console.log(`[scrub-replies] processing ${active.length} active submissions across ${chainsByRoot.size} threads`)

  let repliesInserted = 0
  let statusesUpdated = 0
  let errors = 0

  for (const [rootMessageId, chain] of chainsByRoot) {
    try {
      // ── Fetch thread replies once for the root ─────────────────────────
      // ClickUp's thread structure is flat — all replies on a continuation
      // message live under the root's reply list — so a single GET pulls
      // the whole conversation.
      const replies = await fetchAllReplies(teamId, rootMessageId, clickupToken)

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

      // ── Load existing reply IDs across the chain to dedupe ──────────────
      // Replies are deduped per-submission, but we check across the chain
      // so we don't double-count the same reply when a reply could route
      // to multiple submissions.
      const submissionIds = chain.map(c => c.id)
      const { data: existingRows } = await supabase
        .from('strategy_milestone_replies')
        .select('clickup_reply_id, submission_id')
        .in('submission_id', submissionIds)
        .not('clickup_reply_id', 'is', null)

      const existingIds = new Set<string>(
        (existingRows ?? [])
          .map((r: { clickup_reply_id: string | null }) => r.clickup_reply_id)
          .filter((id): id is string => id !== null),
      )

      // Map message_id → submission for parent_message routing.
      const subByMessageId = new Map<string, ActiveSubmission>()
      for (const c of chain) subByMessageId.set(c.clickup_message_id, c)

      const partnerReplyForSub = new Set<string>()

      for (const reply of replies) {
        const replyId = String(reply.id)
        if (existingIds.has(replyId)) continue

        // ── Route by parent_message ─────────────────────────────────────
        // If the reply's parent_message matches a submission in the chain
        // (the partner replied directly to that continuation message),
        // attribute the reply to that submission. Otherwise fall back to
        // the most recent active submission in the chain (the one the
        // partner is most likely responding to in the broader thread).
        let targetSub: ActiveSubmission | null = null
        if (reply.parent_message) {
          targetSub = subByMessageId.get(reply.parent_message) ?? null
        }
        if (!targetSub) {
          // Prefer the most recent ACTIVE submission so the status flip
          // surfaces the reply on the right row in the queue.
          const activeInChain = chain.filter(c => active.some(a => a.id === c.id))
          targetSub = activeInChain[activeInChain.length - 1]
            ?? chain[chain.length - 1]
        }

        const userId    = Number(reply.user_id)
        const userData  = userMap.get(userId)
        const authorName  = userData?.username ?? `User ${userId}`
        const authorEmail = userData?.email ?? null
        const isPartner   = !userData?.employee &&
          !userData?.email?.toLowerCase().includes('@churchmediasquad.com')

        const detectedAt = reply.date ?? reply.date_assigned
          ? new Date(reply.date ?? reply.date_assigned!).toISOString()
          : new Date().toISOString()

        const { error: insertErr } = await supabase
          .from('strategy_milestone_replies')
          .insert({
            submission_id:      targetSub.id,
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
          console.warn(`[scrub-replies] insert failed (sub ${targetSub.id}):`, insertErr.message)
        } else {
          repliesInserted++
          if (isPartner) partnerReplyForSub.add(targetSub.id)
        }
      }

      // ── Advance status for each submission that received a partner reply
      for (const subId of partnerReplyForSub) {
        const { error: updateErr } = await supabase
          .from('strategy_milestone_submissions')
          .update({ milestone_status: 'partner_replied' })
          .eq('id', subId)
          .in('milestone_status', ['sent', 'waiting_on_partner'])

        if (!updateErr) statusesUpdated++
        else console.warn(`[scrub-replies] status update failed (sub ${subId}):`, updateErr.message)
      }
    } catch (err) {
      console.error(`[scrub-replies] error for thread ${rootMessageId}:`, err instanceof Error ? err.message : String(err))
      errors++
    }

    await delay(200)
  }

  const summary = {
    processed: active.length,
    threads_processed: chainsByRoot.size,
    replies_inserted: repliesInserted,
    statuses_updated: statusesUpdated,
    errors,
  }
  console.log('[scrub-replies] done:', summary)
  return res.status(200).json(summary)
}
