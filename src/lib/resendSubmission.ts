/**
 * Resend a milestone submission's ClickUp message.
 *
 * Used for the rare case where the original send failed (e.g. partner
 * with no `clickup_chat_channels` row, an outage on the ClickUp API,
 * etc.) and the user wants to retry without re-entering the form. The
 * submission row already has the rendered message text, the milestone,
 * and (for continuations) the parent thread, so a resend just replays
 * the send step using the same routing rules as a fresh submission.
 *
 * Safety:
 *   - Refuses if `submission.status === 'sent'` so a stray click can't
 *     post the same message twice.
 *   - On success, updates the submission with the new clickup ids +
 *     status='sent' so the SubmissionCard immediately reflects the
 *     change (and so the cron starts scrubbing replies for it).
 *
 * @mention activations are not re-applied on resend — the original
 * mentions only fire on the first ClickUp message. The resent body
 * matches what the user sees in the "Message sent" panel of the card.
 */

import { supabase } from './supabase'
import { sendClickUpMessage } from './clickup'
import { buildCommentArray } from './clickupComment'
import { resolveRoot } from './submitMilestone'

export interface ResendResult {
  success: boolean
  threadUrl: string | null
  error?: string
}

interface SubmissionRow {
  id: string
  member: number
  milestone_id: string
  is_continuation: boolean
  continuation_of: string | null
  track_name: string | null
  rendered_message: string
  clickup_channel_id: string | null
  clickup_message_id: string | null
  status: string
  is_active: boolean
}

interface MilestoneRow {
  step_name: string | null
}

interface ChannelRow {
  id: string
}

export async function resendSubmission(submissionId: string): Promise<ResendResult> {
  // ── Load the submission ─────────────────────────────────────────────────
  const { data: subData, error: subErr } = await supabase
    .from('strategy_milestone_submissions')
    .select('id, member, milestone_id, is_continuation, continuation_of, track_name, rendered_message, clickup_channel_id, clickup_message_id, status, is_active')
    .eq('id', submissionId)
    .maybeSingle()

  if (subErr) return { success: false, threadUrl: null, error: subErr.message }
  if (!subData) return { success: false, threadUrl: null, error: 'Submission not found.' }

  const submission = subData as SubmissionRow

  if (submission.is_active === false) {
    return {
      success: false,
      threadUrl: null,
      error: 'This submission is archived — restore it first if you really want to resend.',
    }
  }
  if (submission.status === 'sent') {
    return {
      success: false,
      threadUrl: null,
      error: 'This submission was already sent — refusing to post a duplicate.',
    }
  }

  // ── Resolve the parent thread (continuations) ───────────────────────────
  let parentMessageId: string | null = null
  let rootChannelId: string | null = null
  if (submission.is_continuation && submission.continuation_of) {
    const root = await resolveRoot(
      submission.continuation_of,
      submission.milestone_id,
      submission.track_name,
    )
    parentMessageId = root.messageId
    rootChannelId = root.channelId
  }

  // ── Pick the channel ID ─────────────────────────────────────────────────
  // Prefer the row's stored value (set when the submission was first
  // created); fall back to the canonical clickup_chat_channels row;
  // fall back to the root's channel for thread-reply continuations.
  let channelId: string | null = submission.clickup_channel_id ?? null
  if (!channelId) {
    const { data: chanData } = await supabase
      .from('clickup_chat_channels')
      .select('id')
      .eq('memberid', String(submission.member))
      .maybeSingle()
    channelId = (chanData as ChannelRow | null)?.id ?? null
  }
  if (!channelId) channelId = rootChannelId

  // For top-level posts we need a channel; for replies we just need a
  // parent message id (the edge function lets channelId be null then).
  if (!parentMessageId && !channelId) {
    return {
      success: false,
      threadUrl: null,
      error: 'No ClickUp channel on file for this partner — can\'t resend a top-level post.',
    }
  }

  // ── Look up step_name for the announcement title ────────────────────────
  // Replies ignore the title server-side, but we still pass one so a
  // subsequent top-level resend reads consistently with normal sends.
  let announcementTitle: string | null = null
  if (!parentMessageId) {
    const { data: milestoneData } = await supabase
      .from('strategy_milestone_definitions')
      .select('step_name')
      .eq('id', submission.milestone_id)
      .maybeSingle()
    const stepName = (milestoneData as MilestoneRow | null)?.step_name ?? 'Milestone Update'
    announcementTitle = submission.track_name
      ? `${submission.track_name} — ${stepName}`
      : stepName
  }

  // ── Build comment array ─────────────────────────────────────────────────
  // Mentions aren't re-applied on resend (no clean way to derive the
  // ClickUp ids from a stored markdown body). The body still reads
  // correctly; partner @-tags just appear as plain text the second
  // time around.
  const commentArray = buildCommentArray(submission.rendered_message, [])
  if (commentArray.length === 0) {
    return { success: false, threadUrl: null, error: 'Submission has no message body to resend.' }
  }

  // ── Send ────────────────────────────────────────────────────────────────
  let sendResult: { id: string; threadUrl: string | null }
  try {
    sendResult = await sendClickUpMessage(channelId ?? '', commentArray, parentMessageId, announcementTitle)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, threadUrl: null, error: msg }
  }

  if (!sendResult.id) {
    return { success: false, threadUrl: null, error: 'ClickUp returned no message id.' }
  }

  // ── Update the submission row ───────────────────────────────────────────
  // Persist the new ClickUp ids + flip the delivery status. The cron
  // walks rows by clickup_channel_id + clickup_message_id, so this is
  // what re-arms reply scrubbing too.
  const { error: updateErr } = await supabase
    .from('strategy_milestone_submissions')
    .update({
      clickup_message_id: sendResult.id,
      clickup_channel_id: channelId ?? submission.clickup_channel_id,
      clickup_thread_url: sendResult.threadUrl,
      status: 'sent',
    } as Record<string, unknown>)
    .eq('id', submissionId)

  if (updateErr) {
    // The message went out, but the row update failed — surface this
    // so the caller can flag a manual reconciliation.
    return {
      success: true,
      threadUrl: sendResult.threadUrl,
      error: `Sent to ClickUp, but the local record didn't update: ${updateErr.message}`,
    }
  }

  return { success: true, threadUrl: sendResult.threadUrl }
}
