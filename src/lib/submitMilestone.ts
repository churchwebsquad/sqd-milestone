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
  status: 'sent' | 'failed'
  /** Present when the ClickUp send failed but the DB record was still saved. */
  clickupError?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Walk the continuation chain up to find the ROOT submission's clickup_message_id.
 * A continuation may point at another continuation, so we follow continuation_of
 * links until we hit a submission with is_continuation=false (or a dead end).
 * Returns the root message ID, or null if no root message could be resolved.
 */
async function resolveRootMessageId(startSubmissionId: string): Promise<string | null> {
  let currentId: string | null = startSubmissionId
  const seen = new Set<string>()

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const { data } = await supabase
      .from('strategy_milestone_submissions')
      .select('id, is_continuation, continuation_of, clickup_message_id')
      .eq('id', currentId)
      .maybeSingle()

    if (!data) return null
    const row = data as { id: string; is_continuation: boolean; continuation_of: string | null; clickup_message_id: string | null }

    if (!row.is_continuation) {
      return row.clickup_message_id
    }
    if (!row.continuation_of) {
      // Orphaned continuation — fall back to this submission's own message id
      return row.clickup_message_id
    }
    currentId = row.continuation_of
  }

  return null
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

  // ── Step 1: Build comment array + send ClickUp message ───────────────────
  if (formData.channelId) {
    try {
      // Best-effort: look up AM's clickup_id for real @tag in footer.
      const amClickupId = formData.partner?.css_rep
        ? await lookupStaffClickupId(formData.partner.css_rep)
        : null

      // Build the mention registry
      const mentions: ClickUpMention[] = [
        formData.partnerContactClickupId && formData.partnerContactName
          ? { text: formData.partnerContactName, clickupId: formData.partnerContactClickupId }
          : null,
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

      // ── Resolve parent thread message ID for continuations ───────────────
      // When the user chose to post a continuation inside the original thread,
      // walk up the continuation chain to find the root message to reply to.
      let parentMessageId: string | null = null
      if (formData.isContinuation && formData.postAsThreadReply && formData.continuationOfId) {
        parentMessageId = await resolveRootMessageId(formData.continuationOfId)
        if (!parentMessageId) {
          console.warn('[submitMilestone] No root message ID found for continuation; falling back to channel post')
        } else {
          console.log('[submitMilestone] Posting as reply to thread root:', parentMessageId)
        }
      }

      const result = await sendClickUpMessage(formData.channelId, commentArray, parentMessageId)
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
    status,
    clickupError,
  }
}
