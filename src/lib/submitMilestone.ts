import { supabase } from './supabase'
import { sendClickUpMessage } from './clickup'
import { buildCommentArray } from './clickupComment'
import type { ClickUpMention } from './clickupComment'
import { fetchProgressRecap, buildRecapSegments } from './progressRecap'
import type { ProgressRecap } from './progressRecap'
import { loadAppConfig } from './appConfig'
import { resolveMergeFields } from './mergeFields'
import type { FormState } from '../components/submit/types'
import type { StrategyMilestoneSubmission } from '../types/database'

export interface SubmitMilestoneParams {
  formData: FormState
  finalMessage: string
  submittedByEmail: string
  submittedByName: string | null
  /** clickup_id of the submitting staff member — used for tagging in the footer */
  submitterClickupId: number | null
  /**
   * Pre-fetched progress recap (from the Step 7 preview load).
   * If omitted, it is fetched fresh inside submitMilestone.
   */
  progressRecap?: ProgressRecap | null
}

export interface SubmitMilestoneResult {
  submission: StrategyMilestoneSubmission
  clickupMessageId: string | null
  /** Deep link to the chat channel + the message we just posted, when
   *  ClickUp returned one. Surfaced on the success screen so staff can
   *  jump back into the thread to monitor replies. */
  clickupThreadUrl: string | null
  status: 'sent' | 'failed'
  /** Present when the ClickUp send failed but the DB record was still saved. */
  clickupError?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export interface ResolvedRoot {
  messageId: string | null
  /** The root submission's clickup_channel_id — used as a fallback
   *  when the partner has no `clickup_chat_channels` row (e.g. they
   *  were onboarded purely via Log Missed Milestone, where the
   *  channel was scraped from the pasted URL). Reply mode doesn't
   *  technically need the channel for the API call, but the response
   *  thread URL builds it in. */
  channelId: string | null
}

/**
 * Walk the continuation chain up to find the ROOT submission's clickup_message_id,
 * verifying every hop shares the same milestone_id and track_name as the submission
 * we're about to send. This prevents a reply from accidentally landing in a
 * different milestone's thread if the chain ever diverges.
 *
 * Returns the clickup_message_id of the earliest same-milestone+track submission
 * in the chain (the root). Falls back to the most recent matching submission's
 * message id if the chain breaks or the root itself has no message id. Also
 * returns the matching `clickup_channel_id` from the same row so callers can
 * route the reply even when the partner has no canonical channel-table row.
 *
 * Exported so the resend-submission helper can reuse it on retries.
 */
export async function resolveRoot(
  startSubmissionId: string,
  expectedMilestoneId: string,
  expectedTrackName: string | null,
): Promise<ResolvedRoot> {
  let currentId: string | null = startSubmissionId
  const seen = new Set<string>()
  let fallbackMessageId: string | null = null
  let fallbackChannelId: string | null = null

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const { data } = await supabase
      .from('strategy_milestone_submissions')
      .select('id, is_continuation, continuation_of, clickup_message_id, clickup_channel_id, milestone_id, track_name')
      .eq('id', currentId)
      .maybeSingle()

    if (!data) break
    const row = data as {
      id: string
      is_continuation: boolean
      continuation_of: string | null
      clickup_message_id: string | null
      clickup_channel_id: string | null
      milestone_id: string
      track_name: string | null
    }

    // Safety: if this hop isn't the same milestone + track, stop walking.
    // We don't want to reply in a thread that belongs to a different milestone.
    if (row.milestone_id !== expectedMilestoneId || (row.track_name ?? null) !== (expectedTrackName ?? null)) {
      console.warn('[submitMilestone] continuation chain diverged to a different milestone/track — stopping walk')
      break
    }

    // Remember the most recent matching ids as fallbacks
    if (row.clickup_message_id) fallbackMessageId = row.clickup_message_id
    if (row.clickup_channel_id) fallbackChannelId = row.clickup_channel_id

    // Reached the root (or orphaned continuation with no parent)
    if (!row.is_continuation || !row.continuation_of) {
      return {
        messageId: row.clickup_message_id ?? fallbackMessageId,
        channelId: row.clickup_channel_id ?? fallbackChannelId,
      }
    }

    currentId = row.continuation_of
  }

  return { messageId: fallbackMessageId, channelId: fallbackChannelId }
}

/**
 * Look up a staff member's ClickUp user ID by matching css_rep against
 * clickup_users.username (with or without leading @) or clickup_users.email.
 * Returns null if no match — callers fall back to plain text in that case.
 */
async function lookupStaffClickupId(nameOrUsername: string): Promise<number | null> {
  if (!nameOrUsername) return null

  const { data } = await supabase
    .from('clickup_users')
    .select('clickup_id, username, email')
    .not('employee', 'is', null)

  if (!data?.length) return null

  const query = nameOrUsername.toLowerCase().trim()
  const match = (data as Array<{ clickup_id: number; username: string | null; email: string | null }>)
    .find(u => {
      const username = u.username?.replace(/^@/, '').toLowerCase()
      const emailPrefix = u.email?.split('@')[0].toLowerCase()
      const fullEmail = u.email?.toLowerCase()
      return username === query || emailPrefix === query || fullEmail === query
    })

  return match?.clickup_id ?? null
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * Orchestrates a full milestone submission:
 * 1. Build the ClickUp comment array (body + cross-squad recap + footer).
 * 2. Attempt to send the message to ClickUp.
 * 3. Insert a strategy_milestone_submissions row (always — even on ClickUp failure).
 * 4. Insert strategy_submission_assets rows.
 *
 * Throws only for unrecoverable DB failures (the submission record could not be saved).
 * A ClickUp send failure is captured in `clickupError` and `status = 'failed'`.
 */
export async function submitMilestone(params: SubmitMilestoneParams): Promise<SubmitMilestoneResult> {
  const {
    formData,
    finalMessage,
    submittedByEmail,
    submittedByName,
    submitterClickupId,
    progressRecap: preloadedRecap,
  } = params

  let clickupMessageId: string | null = null
  let clickupThreadUrl: string | null = null
  let status: 'sent' | 'failed' = 'failed'
  let clickupError: string | undefined

  // ── Resolve continuation thread root up-front ────────────────────────────
  // We need the root's clickup_message_id (parentMessageId) AND
  // clickup_channel_id ahead of the channel check below — partners
  // logged in via the missed-milestone path have a thread + channel
  // captured on the root submission, even when `clickup_chat_channels`
  // doesn't have a row keyed to their member. Without this, the
  // continuation submit short-circuits with "No ClickUp channel is
  // configured for this partner" and the reply never goes out.
  let parentMessageId: string | null = null
  let rootChannelId: string | null = null
  if (formData.isContinuation && formData.postAsThreadReply && formData.continuationOfId) {
    const root = await resolveRoot(
      formData.continuationOfId,
      formData.selectedMilestone!.id,
      formData.trackName ?? null,
    )
    parentMessageId = root.messageId
    rootChannelId = root.channelId
    if (!parentMessageId) {
      console.warn('[submitMilestone] No matching root message ID for continuation; falling back to new channel post')
    } else {
      console.log('[submitMilestone] Posting as reply to thread root:', parentMessageId, 'channel:', rootChannelId)
    }
  }

  // For top-level posts the channel ID must come from the partner's
  // clickup_chat_channels row. For thread replies we don't strictly
  // need a channel ID for the API call (the reply endpoint keys off
  // parentMessageId), but the root's channel still gives us a clean
  // threadUrl to return.
  const effectiveChannelId = formData.channelId ?? rootChannelId
  const canSend = parentMessageId
    ? !!effectiveChannelId || !!parentMessageId
    : !!formData.channelId

  // ── Step 1: Build comment array + send ClickUp message ───────────────────
  if (canSend) {
    try {
      // Best-effort: look up AM's clickup_id for real @tag in footer.
      const amClickupId = formData.partner?.css_rep
        ? await lookupStaffClickupId(formData.partner.css_rep)
        : null

      // Build the mention registry — one entry per selected partner contact
      // (multi-contact support), plus the submitter + AM mentions in the footer.
      const contactMentions: (ClickUpMention | null)[] = (formData.partnerContacts ?? []).map(c =>
        c.clickupId && c.name ? { text: c.name, clickupId: c.clickupId } : null,
      )

      const mentions: ClickUpMention[] = [
        ...contactMentions,
        submitterClickupId && submittedByName
          ? { text: submittedByName, clickupId: submitterClickupId }
          : null,
        amClickupId && formData.partner?.css_rep
          ? { text: formData.partner.css_rep, clickupId: amClickupId }
          : null,
      ].filter((m): m is ClickUpMention => m !== null)

      // ── Fetch (or reuse) the cross-squad progress recap ──────────────────
      const portalUrl = `${window.location.origin}/portal/${formData.partner!.portal_token ?? formData.partner!.member}`

      let recap: ProgressRecap | null = null
      if (formData.includeRecap !== false) {
        try {
          recap = preloadedRecap
            ?? await fetchProgressRecap(
              formData.partner!.member,
              formData.selectedMilestone!.squad,
              formData.currentMilestoneId || null,
              formData.nextMilestoneId,
            )
        } catch (recapErr) {
          console.warn('[submitMilestone] Progress recap fetch failed, skipping:', recapErr)
        }
      }

      // ── Build footer segments if enabled ─────────────────────────────────
      let footerSegments: ReturnType<typeof buildCommentArray> = []
      if (formData.includeFooter !== false) {
        try {
          const config = await loadAppConfig()
          const footerText = resolveMergeFields(config.standard_footer, {
            submitter_name: submittedByName ?? undefined,
            account_manager: formData.partner?.css_rep ?? undefined,
          })
          footerSegments = buildCommentArray(footerText, mentions)
        } catch (footerErr) {
          console.warn('[submitMilestone] Footer build failed, skipping:', footerErr)
        }
      }

      // ── Build combined comment array ─────────────────────────────────────
      //   body segments (with bold + mention tags)
      // + recap section (structured ClickUp rich-text)
      // + footer (with mention tags)
      const bodySegments  = buildCommentArray(finalMessage, mentions)
      const recapSegments = recap ? buildRecapSegments(recap, portalUrl) : []

      const commentArray = [
        ...bodySegments,
        ...recapSegments,
        ...footerSegments,
      ]

      console.log('[submitMilestone] final comment array:', JSON.stringify(commentArray, null, 2))

      // (Continuation thread root was already resolved above so we
      // could decide whether to send at all; parentMessageId +
      // effectiveChannelId are in scope here.)

      // Announcement title — sourced based on the user's pick on the
      // Message step:
      //   - 'milestone' (default + legacy): step name, with the
      //     track-name prefix for ministry-subbrand continuations.
      //   - 'template':  the applied template's subject_line, with
      //     merge fields resolved (same set the body uses).
      //   - 'custom':    user-typed subject, also merge-resolved.
      const stepName = formData.selectedMilestone?.step_name ?? 'Milestone Update'
      const milestoneSubject = formData.trackName
        ? `${formData.trackName} — ${stepName}`
        : stepName

      const subjectMergeData = {
        church_name: formData.partner?.church_name,
        first_name_of_primary: formData.partner?.first_name_of_primary,
        step_name: formData.selectedMilestone?.step_name,
        section_group: formData.selectedMilestone?.section_group,
        submitter_name: submittedByName,
        account_manager: formData.partner?.css_rep,
        partner_contact_name: formData.partnerContactName || null,
      }

      let announcementTitle: string
      if (formData.subjectMode === 'template' && formData.templateSubjectLine) {
        announcementTitle = resolveMergeFields(formData.templateSubjectLine, subjectMergeData).trim() || milestoneSubject
      } else if (formData.subjectMode === 'custom' && formData.customSubject.trim()) {
        announcementTitle = resolveMergeFields(formData.customSubject, subjectMergeData).trim() || milestoneSubject
      } else {
        announcementTitle = milestoneSubject
      }

      const result = await sendClickUpMessage(effectiveChannelId ?? '', commentArray, parentMessageId, announcementTitle)
      clickupMessageId = result.id
      clickupThreadUrl = result.threadUrl
      status = 'sent'
    } catch (err) {
      clickupError = err instanceof Error ? err.message : String(err)
      console.error('[submitMilestone] ClickUp send failed:', clickupError)
    }
  } else {
    clickupError = 'No ClickUp channel is configured for this partner.'
  }

  // ── Step 2: Save submission record ────────────────────────────────────────
  const { data: submission, error: insertError } = await supabase
    .from('strategy_milestone_submissions')
    .insert({
      member: formData.partner!.member,
      milestone_id: formData.selectedMilestone!.id,
      template_id: null,
      is_continuation: formData.isContinuation,
      continuation_of: formData.continuationOfId,
      track_name: formData.trackName,
      current_milestone_id: formData.currentMilestoneId,
      next_milestone_id: formData.nextMilestoneId,
      rendered_message: finalMessage,
      clickup_channel_id: formData.channelId,
      clickup_message_id: clickupMessageId,
      partner_contact_name: formData.partnerContactName || null,
      partner_contact_clickup_id: formData.partnerContactClickupId,
      submitted_by_email: submittedByEmail,
      submitted_by_name: submittedByName,
      status,
    })
    .select()
    .single()

  if (insertError || !submission) {
    throw new Error(insertError?.message ?? 'Failed to save submission record.')
  }

  // Best-effort: store the thread URL (requires clickup_thread_url column)
  if (clickupThreadUrl) {
    await supabase
      .from('strategy_milestone_submissions')
      .update({ clickup_thread_url: clickupThreadUrl } as Record<string, unknown>)
      .eq('id', submission.id)
      .then(({ error }) => {
        if (error) console.warn('[submitMilestone] thread URL update skipped:', error.message)
      })
  }

  // ── Auto-approve prior-step submissions ──────────────────────────────────
  // When staff sends a milestone further down the pathway (e.g. Brand Guide
  // after Mood Boards), any earlier-step submissions for this partner in the
  // same pathway + track are implicitly approved. Skips continuations (those
  // are the same step) and skips rows already in a terminal state.
  if (!formData.isContinuation && formData.selectedMilestone) {
    try {
      const currentStep = formData.selectedMilestone.step_number
      const { squad, pathway } = formData.selectedMilestone

      // Find earlier-step milestone ids for this squad + pathway
      const { data: priorDefs } = await supabase
        .from('strategy_milestone_definitions')
        .select('id')
        .eq('squad', squad)
        .eq('pathway', pathway)
        .lt('step_number', currentStep)

      const priorIds = (priorDefs ?? []).map((d: { id: string }) => d.id)
      if (priorIds.length > 0) {
        // Scope by track_name when present (Ministry Subbrand multi-track support)
        let q = supabase
          .from('strategy_milestone_submissions')
          .update({ milestone_status: 'approved' } as Record<string, unknown>)
          .eq('member', formData.partner!.member)
          .in('milestone_id', priorIds)
          .not('milestone_status', 'in', '("approved","escalated")')
        if (formData.trackName) q = q.eq('track_name', formData.trackName)
        else q = q.is('track_name', null)

        const { error: approveErr, count } = await q
        if (approveErr) {
          console.warn('[submitMilestone] auto-approve prior steps skipped:', approveErr.message)
        } else if (count) {
          console.log(`[submitMilestone] auto-approved ${count} prior submission(s) for ${squad}/${pathway}`)
        }
      }
    } catch (err) {
      console.warn('[submitMilestone] auto-approve failed:', err instanceof Error ? err.message : err)
    }
  }

  // ── Step 3: Save assets (best-effort) ────────────────────────────────────
  if (formData.assets.length > 0) {
    const { error: assetError } = await supabase
      .from('strategy_submission_assets')
      .insert(
        formData.assets.map((a, i) => ({
          submission_id: submission.id,
          asset_type: a.type,
          asset_url: a.url,
          asset_label: a.label || null,
          sort_order: i,
        }))
      )

    if (assetError) {
      console.error('[submitMilestone] Asset insert failed:', assetError.message)
    }
  }

  return {
    submission: submission as StrategyMilestoneSubmission,
    clickupMessageId,
    clickupThreadUrl,
    status,
    clickupError,
  }
}
