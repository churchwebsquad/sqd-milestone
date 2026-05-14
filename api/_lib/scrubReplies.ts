/**
 * Shared scrub-replies core. Used by:
 *   - api/cron/scrub-replies.ts        — daily Vercel cron, walks every active submission
 *   - api/scrub-replies/run.ts         — manual on-demand button (per submission or per partner)
 *
 * Given an array of submissions to consider, this:
 *   1. Walks continuation chains so a multi-round milestone shares one ClickUp thread
 *   2. Pulls thread replies from ClickUp v3 once per chain root
 *   3. Routes each reply to whichever submission was active when the reply was posted
 *      (timestamp-window rule, mirrors the cron's behavior)
 *   4. Inserts new replies into strategy_milestone_replies (deduped by clickup_reply_id)
 *   5. Flips milestone_status → partner_replied for any submission with a fresh partner reply
 *
 * Vercel hides files under api/_lib/ from the routing layer (underscore prefix), so this
 * can be imported from both serverless functions without becoming a route itself.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ActiveSubmission {
  id: string
  clickup_channel_id: string
  clickup_message_id: string
  milestone_status: string
  is_continuation: boolean
  continuation_of: string | null
  submitted_at: string
}

interface V3Reply {
  id: string | number
  content?: string
  user_id?: string | number
  date?: number
  date_assigned?: number
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

export interface ScrubResult {
  threadsProcessed: number
  repliesInserted: number
  partnerRepliesInserted: number
  statusesUpdated: number
  errors: number
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Thrown when ClickUp says the message no longer exists. Caller marks
 *  the submission so we stop trying that thread on future scrubs. */
class ClickUpMessageGoneError extends Error {
  constructor(messageId: string) {
    super(`ClickUp message ${messageId} no longer exists (404)`)
    this.name = 'ClickUpMessageGoneError'
  }
}

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
    if (res.status === 404) {
      throw new ClickUpMessageGoneError(messageId)
    }
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

/**
 * Scrub replies for the given submissions. Caller is responsible for
 * narrowing the input set (cron passes everything active; the manual
 * endpoint passes a single id or one partner's submissions).
 */
export async function scrubReplies(
  supabase: SupabaseClient,
  teamId: string,
  clickupToken: string,
  submissions: ActiveSubmission[],
  opts: { perThreadDelayMs?: number } = {},
): Promise<ScrubResult> {
  const perThreadDelayMs = opts.perThreadDelayMs ?? 200

  // Pull continuation parents we don't already have so chain walking
  // can route replies to the right round.
  const allSubs = new Map<string, ActiveSubmission>()
  for (const s of submissions) allSubs.set(s.id, s)

  const parentIdsToFetch = new Set<string>()
  for (const s of submissions) {
    let cursor: string | null = s.continuation_of
    while (cursor && !allSubs.has(cursor) && !parentIdsToFetch.has(cursor)) {
      parentIdsToFetch.add(cursor)
      break
    }
  }
  if (parentIdsToFetch.size > 0) {
    const { data: parentRows } = await supabase
      .from('strategy_milestone_submissions')
      .select('id, clickup_channel_id, clickup_message_id, milestone_status, is_continuation, continuation_of, submitted_at')
      .in('id', [...parentIdsToFetch])
    for (const r of (parentRows ?? []) as ActiveSubmission[]) {
      if (r.clickup_message_id) allSubs.set(r.id, r)
    }
  }

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

  // Group by root message id so we only hit ClickUp once per thread.
  const chainsByRoot = new Map<string, ActiveSubmission[]>()
  const processedRoots = new Set<string>()
  for (const s of submissions) {
    const chain = findChain(s)
    const root = chain.find(c => !c.is_continuation) ?? chain[0]
    if (!root.clickup_message_id) continue
    if (processedRoots.has(root.clickup_message_id)) continue
    chainsByRoot.set(root.clickup_message_id, chain)
    processedRoots.add(root.clickup_message_id)
  }

  let repliesInserted = 0
  let partnerRepliesInserted = 0
  let statusesUpdated = 0
  let errors = 0

  for (const [rootMessageId, chain] of chainsByRoot) {
    try {
      const replies = await fetchAllReplies(teamId, rootMessageId, clickupToken)
      if (replies.length === 0) {
        if (perThreadDelayMs > 0) await delay(perThreadDelayMs)
        continue
      }

      const userIds = [...new Set(replies.map(r => Number(r.user_id)).filter(Boolean))]
      const userMap = new Map<number, ClickUpUserRow>()
      if (userIds.length > 0) {
        const { data: userRows } = await supabase
          .from('clickup_users')
          .select('clickup_id, username, email, employee')
          .in('clickup_id', userIds)
        for (const u of (userRows ?? []) as ClickUpUserRow[]) {
          userMap.set(u.clickup_id, u)
        }
      }

      // Dedupe by clickup_reply_id across the chain so we don't double-write.
      const submissionIds = chain.map(c => c.id)
      const { data: existingRows } = await supabase
        .from('strategy_milestone_replies')
        .select('clickup_reply_id')
        .in('submission_id', submissionIds)
        .not('clickup_reply_id', 'is', null)
      const existingIds = new Set<string>(
        (existingRows ?? [])
          .map((r: { clickup_reply_id: string | null }) => r.clickup_reply_id)
          .filter((id): id is string => id !== null),
      )

      // Timestamp-window routing — each reply attributes to whichever
      // submission was the most recent at the time the reply was posted.
      const chainBySendTime = [...chain].sort(
        (a, b) => a.submitted_at.localeCompare(b.submitted_at),
      )

      const partnerReplyForSub = new Set<string>()

      for (const reply of replies) {
        const replyId = String(reply.id)
        if (existingIds.has(replyId)) continue

        const replyTsRaw = reply.date ?? reply.date_assigned
        const replyTs = replyTsRaw ? new Date(replyTsRaw).toISOString() : new Date().toISOString()

        let targetSub: ActiveSubmission | null = null
        for (const c of chainBySendTime) {
          if (c.submitted_at <= replyTs) targetSub = c
          else break
        }
        if (!targetSub) targetSub = chainBySendTime[0] ?? chain[0]

        const userId = Number(reply.user_id)
        const userData = userMap.get(userId)
        const authorName = userData?.username ?? `User ${userId}`
        const authorEmail = userData?.email ?? null
        const isPartner = !userData?.employee &&
          !userData?.email?.toLowerCase().includes('@churchmediasquad.com')

        const { error: insertErr } = await supabase
          .from('strategy_milestone_replies')
          .insert({
            submission_id: targetSub.id,
            reply_text: reply.content ?? '',
            reply_author_name: authorName,
            reply_author_email: authorEmail,
            is_partner_reply: isPartner,
            triage_category: null,
            source: 'clickup_thread',
            detected_at: replyTs,
            clickup_reply_id: replyId,
          })

        if (insertErr) {
          console.warn(`[scrubReplies] insert failed (sub ${targetSub.id}):`, insertErr.message)
        } else {
          repliesInserted++
          if (isPartner) {
            partnerRepliesInserted++
            partnerReplyForSub.add(targetSub.id)
          }
        }
      }

      for (const subId of partnerReplyForSub) {
        const { error: updateErr } = await supabase
          .from('strategy_milestone_submissions')
          .update({ milestone_status: 'partner_replied' })
          .eq('id', subId)
          .in('milestone_status', ['sent', 'waiting_on_partner'])
        if (!updateErr) statusesUpdated++
        else console.warn(`[scrubReplies] status update failed (sub ${subId}):`, updateErr.message)
      }
    } catch (err) {
      // ClickUp 404 on the parent message = it was deleted. Clear the
      // submission's clickup_message_id so we never poll this thread
      // again. Don't count it as an error — the cleanup is the action.
      if (err instanceof ClickUpMessageGoneError) {
        const submissionIds = chain.map(c => c.id)
        const { error: clearErr } = await supabase
          .from('strategy_milestone_submissions')
          .update({ clickup_message_id: null })
          .in('id', submissionIds)
          .eq('clickup_message_id', rootMessageId)
        if (clearErr) {
          console.warn(`[scrubReplies] failed to clear stale message ${rootMessageId}:`, clearErr.message)
          errors++
        } else {
          console.log(`[scrubReplies] auto-cleared stale ClickUp message ${rootMessageId} (submissions: ${submissionIds.join(', ')})`)
        }
      } else {
        console.error(`[scrubReplies] error for thread ${rootMessageId}:`,
          err instanceof Error ? err.message : String(err))
        errors++
      }
    }

    if (perThreadDelayMs > 0) await delay(perThreadDelayMs)
  }

  return {
    threadsProcessed: chainsByRoot.size,
    repliesInserted,
    partnerRepliesInserted,
    statusesUpdated,
    errors,
  }
}

/** Resolves the ClickUp workspace (team) id once. Both routes call this
 *  before invoking scrubReplies. */
export async function fetchTeamId(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.clickup.com/api/v2/team', {
      headers: { Authorization: token },
    })
    const body = await res.json() as { teams?: Array<{ id: string }> }
    return body.teams?.[0]?.id ?? null
  } catch {
    return null
  }
}
