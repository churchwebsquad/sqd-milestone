/**
 * Manual reply-scrub endpoint — POST /api/scrub-replies/run
 *
 * Auth: Supabase user JWT in `Authorization: Bearer <jwt>`. Any signed-in
 * staff member can trigger a scrub. Returns counts so the UI can show
 * "X new replies pulled" feedback.
 *
 * Body (JSON):
 *   { submissionId: string }   — scrub one thread (per-card "Refresh" button)
 *   { member: number }         — scrub every active submission for one partner
 *                                ("Refresh all" on the Account Log page)
 *
 * The actual scrub logic is shared with the cron via api/_lib/scrubReplies.ts —
 * cron + manual button do exactly the same thing. This endpoint just narrows
 * the active set before handing it off.
 */

import { createClient } from '@supabase/supabase-js'
import { scrubReplies, fetchTeamId, type ActiveSubmission } from '../_lib/scrubReplies'

export default async function handler(
  req: { method: string; headers: Record<string, string | string[] | undefined>; body?: unknown },
  res: {
    status: (code: number) => { json: (body: unknown) => void }
    json: (body: unknown) => void
  },
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clickupToken = process.env.CLICKUP_MILESTONE_API_TOKEN
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !clickupToken) {
    return res.status(500).json({ error: 'Missing required environment variables' })
  }

  // ── Verify caller is a signed-in staff member ─────────────────────────────
  // The browser sends the user's Supabase access token; we validate it
  // against the auth server before doing anything privileged.
  const authHeader = Array.isArray(req.headers['authorization'])
    ? req.headers['authorization'][0]
    : req.headers['authorization']
  const jwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'Invalid session' })
  }

  // ── Parse + validate input ────────────────────────────────────────────────
  const body = (req.body ?? {}) as { submissionId?: unknown; member?: unknown }
  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : null
  const memberRaw = typeof body.member === 'number' ? body.member
    : typeof body.member === 'string' ? Number(body.member)
    : null
  const member = memberRaw != null && Number.isFinite(memberRaw) ? memberRaw : null

  if (!submissionId && member == null) {
    return res.status(400).json({ error: 'Provide either `submissionId` or `member` in the body.' })
  }

  // ── Service-role client for the actual scrub ──────────────────────────────
  // RLS would block a staff JWT from updating other partners' rows, but
  // any signed-in staff member is authorized to trigger scrubs site-wide,
  // so we fall through to the service-role key for the data work — same
  // pattern the cron uses.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const teamId = await fetchTeamId(clickupToken)
  if (!teamId) return res.status(500).json({ error: 'Could not resolve ClickUp team ID' })

  // Narrow the active set to the requested scope.
  let q = supabase
    .from('strategy_milestone_submissions')
    .select('id, clickup_channel_id, clickup_message_id, milestone_status, is_continuation, continuation_of, submitted_at')
    .eq('is_active', true)
    .not('clickup_channel_id', 'is', null)
    .not('clickup_message_id', 'is', null)
  if (submissionId) q = q.eq('id', submissionId)
  if (member != null) q = q.eq('member', member)

  const { data: subData, error: fetchErr } = await q
  if (fetchErr) return res.status(500).json({ error: fetchErr.message })

  const submissions = (subData ?? []) as ActiveSubmission[]
  if (submissions.length === 0) {
    return res.status(200).json({
      processed: 0,
      threads_processed: 0,
      replies_inserted: 0,
      partner_replies_inserted: 0,
      statuses_updated: 0,
      errors: 0,
      message: submissionId
        ? 'Submission not found, archived, or has no ClickUp thread to scrub.'
        : 'No active submissions for this partner.',
    })
  }

  // No artificial delay between threads on a manual trigger — the staff
  // member is waiting on the response.
  const result = await scrubReplies(supabase, teamId, clickupToken, submissions, {
    perThreadDelayMs: 0,
  })

  return res.status(200).json({
    processed: submissions.length,
    threads_processed: result.threadsProcessed,
    replies_inserted: result.repliesInserted,
    partner_replies_inserted: result.partnerRepliesInserted,
    statuses_updated: result.statusesUpdated,
    errors: result.errors,
  })
}
