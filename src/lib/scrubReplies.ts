/**
 * Client-side trigger for the manual reply-scrub endpoint.
 *
 * Why this exists: the daily Vercel cron at /api/cron/scrub-replies
 * gives partner replies a 24-hour latency at best, and goes silent
 * entirely when CRON_SECRET drifts (an outage we lived through). The
 * "Refresh replies" buttons on AccountLogPage hit /api/scrub-replies/run
 * via this helper so staff can pull the latest replies on demand —
 * one thread at a time, or all of a partner's threads in bulk.
 */

import { supabase } from './supabase'

export interface ScrubResponse {
  processed: number
  threads_processed: number
  replies_inserted: number
  partner_replies_inserted: number
  statuses_updated: number
  errors: number
  message?: string
}

interface ScrubInput {
  submissionId?: string
  member?: number
}

export async function runScrubReplies(input: ScrubInput): Promise<ScrubResponse> {
  if (!input.submissionId && input.member == null) {
    throw new Error('runScrubReplies requires either submissionId or member.')
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('Not signed in.')

  const res = await fetch('/api/scrub-replies/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    let msg = `Scrub failed (${res.status})`
    try {
      const body = await res.json() as { error?: string }
      if (body?.error) msg = body.error
    } catch { /* ignore parse errors */ }
    throw new Error(msg)
  }
  return await res.json() as ScrubResponse
}
