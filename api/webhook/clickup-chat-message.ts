/**
 * Vercel Serverless Function — /api/webhook/clickup-chat-message
 *
 * Receives a webhook POST from ClickUp Chat Automations whenever
 * "Message is posted" fires in a tracked partner channel. ClickUp's
 * Automation builder configures these per-channel; setup steps live
 * in references/clickup-chat-webhook-setup.md.
 *
 * Payload (ClickUp delivers via URL query params, not JSON body):
 *   ?comment_id=<message_id>&channel_id=<channel_id>
 *
 * Auth: Authorization header with the value of CLICKUP_WEBHOOK_SECRET.
 * ClickUp sets this when the automation is created and it cannot be
 * viewed afterward — store the same value here.
 *
 * Behavior: hands the channel's active submissions to the shared
 * scrubReplies helper. Dedupe-by-clickup_reply_id means duplicate
 * deliveries (ClickUp retries failed calls for 1h15m) are safe.
 *
 * Cron at /api/cron/scrub-replies stays as a backstop catch.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { scrubReplies, fetchTeamId, type ActiveSubmission } from '../_lib/scrubReplies'

// Legacy-compatible runtime config — works across all Vercel Function
// runtimes (newer ones also accept `export const maxDuration = 60`).
export const config = {
  maxDuration: 60,
}

export default async function handler(req: any, res: any) {
  try {
    return await runHandler(req, res)
  } catch (err: any) {
    console.error('[clickup-chat-message] unhandled error:', err?.message, err?.stack)
    return res.status(500).json({
      error: `Unhandled exception: ${err?.message ?? 'unknown'}`,
    })
  }
}

async function runHandler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth ────────────────────────────────────────────────────────────
  const webhookSecret = process.env.CLICKUP_WEBHOOK_SECRET
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clickupToken = process.env.CLICKUP_MILESTONE_API_TOKEN
  const missing: string[] = []
  if (!webhookSecret) missing.push('CLICKUP_WEBHOOK_SECRET')
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL')
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!clickupToken) missing.push('CLICKUP_MILESTONE_API_TOKEN')
  if (missing.length) {
    console.error('[clickup-chat-message] missing env vars:', missing.join(', '))
    return res.status(500).json({ error: `Missing required environment variables: ${missing.join(', ')}` })
  }

  const authHeader = Array.isArray(req.headers['authorization'])
    ? req.headers['authorization'][0]
    : req.headers['authorization']
  // ClickUp lets you set the header value freely. Accept either the
  // raw secret or a "Bearer <secret>" form for flexibility.
  const provided = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader
  if (provided !== webhookSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // ── Parse the trigger ──────────────────────────────────────────────
  // ClickUp's Automation sends the dynamic fields as URL query params.
  // The query object can land via req.query (Vercel) or via the
  // request URL — handle both.
  const query = (req.query ?? {}) as Record<string, string | string[] | undefined>
  const queryFrom = (key: string) => {
    const v = query[key]
    if (Array.isArray(v)) return v[0] ?? null
    if (typeof v === 'string') return v
    return null
  }
  let commentId = queryFrom('comment_id')
  let channelId = queryFrom('channel_id')
  if ((!commentId || !channelId) && typeof req.url === 'string') {
    try {
      const url = new URL(req.url, 'http://localhost')
      commentId ??= url.searchParams.get('comment_id')
      channelId ??= url.searchParams.get('channel_id')
    } catch {
      // ignore — already null
    }
  }

  console.log(`[clickup-chat-message] received: channel=${channelId} comment=${commentId}`)

  if (!channelId) {
    // No channel scoping — we can't target submissions. Bail with 200
    // so ClickUp doesn't retry forever. The cron will catch it.
    return res.status(200).json({ ok: true, ignored: 'missing channel_id' })
  }

  // ── Find active submissions in this channel ────────────────────────
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const { data: subData, error: fetchErr } = await supabase
    .from('strategy_milestone_submissions')
    .select('id, clickup_channel_id, clickup_message_id, milestone_status, is_continuation, continuation_of, submitted_at')
    .eq('clickup_channel_id', channelId)
    .eq('is_active', true)
    .in('milestone_status', ['sent', 'waiting_on_partner', 'partner_replied'])
    .not('clickup_message_id', 'is', null)
  if (fetchErr) {
    console.error('[clickup-chat-message] fetch error:', fetchErr.message)
    return res.status(500).json({ error: fetchErr.message })
  }
  const active = (subData ?? []) as ActiveSubmission[]
  if (active.length === 0) {
    console.log(`[clickup-chat-message] no active submissions for channel ${channelId}`)
    return res.status(200).json({ ok: true, ignored: 'no active submissions in this channel' })
  }

  // ── Run a targeted scrub on this channel's submissions ─────────────
  const teamId = await fetchTeamId(clickupToken)
  if (!teamId) {
    return res.status(500).json({ error: 'Could not resolve ClickUp team ID' })
  }

  const result = await scrubReplies(supabase, teamId, clickupToken, active, {
    perThreadDelayMs: 0, // webhook is per-event, don't add latency
  })

  const summary = {
    ok: true,
    channel_id: channelId,
    comment_id: commentId,
    submissions_in_channel: active.length,
    threads_processed: result.threadsProcessed,
    replies_inserted: result.repliesInserted,
    partner_replies_inserted: result.partnerRepliesInserted,
    statuses_updated: result.statusesUpdated,
    errors: result.errors,
  }
  console.log('[clickup-chat-message] done:', summary)
  return res.status(200).json(summary)
}
