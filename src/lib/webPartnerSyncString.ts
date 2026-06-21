/**
 * Partner-sync one-liner generator.
 *
 * Account managers in a partner call need a single readable sentence
 * describing where the project is and what's next. The planning tab
 * exposes this string with a "Copy" button so the AM can drop it
 * into Slack / email / a ClickUp comment.
 *
 * Rules:
 *  - Strategist-language only. No internal jargon (no "cowork step 8",
 *    no "engine_state.current_phase").
 *  - Names a concrete next milestone with an approximate ETA when
 *    feasibility permits.
 *  - If manually paused, surfaces the reason verbatim.
 */
import type { CurrentActivity } from './webCurrentActivity'
import type { ManualSubStatus, StrategyWebProject } from '../types/database'

interface Inputs {
  project:  StrategyWebProject
  activity: CurrentActivity
  /** Partner-facing name override (church name). */
  partnerName?: string | null
}

export function buildPartnerSyncString(i: Inputs): string {
  const { project, activity, partnerName } = i
  const who = partnerName ?? project.name ?? 'your site'

  // Manual override wins — partner deserves the real reason verbatim.
  if (activity.signal === 'manual_override' && activity.manualStatus) {
    return manualSentence(who, activity.manualStatus, activity.manualReason ?? null)
  }

  if (activity.signal === 'launched') {
    return `${who} launched on ${project.launch_date ?? '—'}. Post-launch monitoring continues.`
  }

  if (activity.signal === 'intake' || activity.signal === 'phase_only') {
    return `${who} is in the ${activity.phase} phase. Next milestone TBD as the project picks up.`
  }

  // Copy engine: describe the page-count progress.
  if (activity.signal === 'copy_engine') {
    if (activity.progressDone != null && activity.progressTotal != null) {
      return `${who}: we're ${activity.stepName?.toLowerCase() ?? 'drafting'} (${activity.progressDone} of ${activity.progressTotal} pages so far). Next milestone: internal review, then your R1 review window.`
    }
    return `${who}: we're ${activity.stepName?.toLowerCase() ?? 'drafting copy'} now. Next milestone: internal review, then your R1 review window.`
  }

  // Cowork pipeline step.
  if (activity.signal === 'cowork_step') {
    const step = activity.stepName ?? 'the next strategy step'
    const progress = activity.progressDone != null && activity.progressTotal != null
      ? ` (${activity.progressDone} of ${activity.progressTotal} done)`
      : ''
    return `${who}: we're working on ${step.toLowerCase()}${progress}. Once that wraps, we'll send you the copy package for review.`
  }

  // Milestone signal.
  if (activity.signal === 'milestone') {
    const step = activity.stepName ?? 'the next milestone'
    return `${who}: we're on ${step.toLowerCase()}. Next milestone follows once this lands.`
  }

  // ClickUp tasks fallback.
  if (activity.signal === 'clickup_tasks') {
    return `${who} is mid-${activity.phase}. ${activity.progressDone != null && activity.progressTotal != null ? `${activity.progressDone} of ${activity.progressTotal} tasks closed.` : ''} We'll be in touch when the next review is ready.`
  }

  return `${who}: ${activity.oneLiner}.`
}

function manualSentence(who: string, status: ManualSubStatus, reason: string | null): string {
  const reasonClause = reason ? ` (${reason})` : ''
  switch (status) {
    case 'waiting_partner':
      return `${who} is waiting on partner input${reasonClause}. We'll resume the timeline once we hear back.`
    case 'blocked':
      return `${who} is currently blocked${reasonClause}. We're working to unblock.`
    case 'paused':
      return `${who} is paused${reasonClause}.`
    case 'in_progress':
    default:
      return `${who} is in progress.`
  }
}
