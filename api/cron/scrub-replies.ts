/**
 * Vercel Serverless Cron — /api/cron/scrub-replies
 *
 * Runs weekdays at 3 PM ET (19:00 UTC) via vercel.json cron.
 *
 * Pulls the active set of submissions and hands them to the shared
 * scrub helper at api/_lib/scrubReplies.ts. The same helper powers
 * the manual /api/scrub-replies/run endpoint so the cron and the
 * "Refresh replies" button do exactly the same thing.
 *
 * Security: verifies Authorization: Bearer <CRON_SECRET> header.
 * NOTE: Vercel sets that header automatically when a CRON_SECRET env
 * var is configured in the project. If your cron is returning 401,
 * set CRON_SECRET in Vercel project settings to any random string.
 *
 * DB access: SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
 */

import { createClient } from '@supabase/supabase-js'
// `.js` extension required by Vercel's nodejs24.x runtime (strict ESM
// resolution). The source is `.ts`; TypeScript compiles it to `.js`.
import { scrubReplies, fetchTeamId, type ActiveSubmission } from '../_lib/scrubReplies.js'

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
  const cronSecret = process.env.CRON_SECRET
  const authHeader = Array.isArray(req.headers['authorization'])
    ? req.headers['authorization'][0]
    : req.headers['authorization']
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clickupToken = process.env.CLICKUP_MILESTONE_API_TOKEN
  if (!supabaseUrl || !serviceRoleKey || !clickupToken) {
    return res.status(500).json({ error: 'Missing required environment variables' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const teamId = await fetchTeamId(clickupToken)
  if (!teamId) {
    return res.status(500).json({ error: 'Could not resolve ClickUp team ID' })
  }

  // ── Active set ───────────────────────────────────────────────────────────
  const { data: subData, error: fetchErr } = await supabase
    .from('strategy_milestone_submissions')
    .select('id, clickup_channel_id, clickup_message_id, milestone_status, is_continuation, continuation_of, submitted_at')
    .in('milestone_status', ['sent', 'waiting_on_partner'])
    .eq('is_active', true)
    .not('clickup_channel_id', 'is', null)
    .not('clickup_message_id', 'is', null)
  if (fetchErr) {
    console.error('[scrub-replies] fetch error:', fetchErr.message)
    return res.status(500).json({ error: fetchErr.message })
  }
  const active = (subData ?? []) as ActiveSubmission[]
  console.log(`[scrub-replies] cron processing ${active.length} active submissions`)

  const result = await scrubReplies(supabase, teamId, clickupToken, active, {
    perThreadDelayMs: 200,
  })

  // ── One-off backfill ─────────────────────────────────────────────────────
  // The existing reply rows aren't re-evaluated against the timestamp-
  // window logic (dedupe on clickup_reply_id skips them). One specific
  // reply was misrouted under the old parent_message rule and needs to
  // land on the continuation row instead. Idempotent — once the row's
  // submission_id matches the target, the UPDATE no-ops.
  let backfillUpdated = 0
  const ONE_OFF_REPLY_BACKFILLS: Array<{ reply: string; targetMessageId: string }> = [
    { reply: '80170029766692', targetMessageId: '80170029757356' },
  ]
  for (const job of ONE_OFF_REPLY_BACKFILLS) {
    try {
      const { data: targetSub } = await supabase
        .from('strategy_milestone_submissions')
        .select('id')
        .eq('clickup_message_id', job.targetMessageId)
        .maybeSingle()
      if (!targetSub?.id) continue
      const { error: updateErr, count } = await supabase
        .from('strategy_milestone_replies')
        .update({ submission_id: targetSub.id }, { count: 'exact' })
        .eq('clickup_reply_id', job.reply)
        .neq('submission_id', targetSub.id)
      if (updateErr) {
        console.warn(`[scrub-replies] backfill failed for reply ${job.reply}:`, updateErr.message)
      } else if (count && count > 0) {
        backfillUpdated += count
        console.log(`[scrub-replies] backfilled reply ${job.reply} → submission ${targetSub.id}`)
      }
    } catch (err) {
      console.warn(`[scrub-replies] backfill error for reply ${job.reply}:`,
        err instanceof Error ? err.message : String(err))
    }
  }

  const summary = {
    processed: active.length,
    threads_processed: result.threadsProcessed,
    replies_inserted: result.repliesInserted,
    partner_replies_inserted: result.partnerRepliesInserted,
    statuses_updated: result.statusesUpdated,
    backfill_updated: backfillUpdated,
    errors: result.errors,
  }
  console.log('[scrub-replies] done:', summary)
  return res.status(200).json(summary)
}
