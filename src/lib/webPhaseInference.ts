/**
 * Phase progress + remaining hours, inferred from ClickUp tasks.
 *
 * Categorizes each task by its name into one of the project phases
 * (intake / content / design / dev / review / launched), then
 * computes per-phase progress and an aggregate remaining-minutes
 * figure as `Σ time_estimate_minutes of incomplete tasks`.
 *
 * Pure — no I/O. The caller fetches `task_details` rows and hands
 * them off. `computeProjectHealth` + `computeDevQueue` consume the
 * inferred numbers as a fallback when the team hasn't entered manual
 * phase_progress / manual_remaining_hours, so the math reflects what
 * ClickUp actually says about where the work is.
 */
import type { WebProjectPhase, PhaseProgress } from '../types/database'

export interface ClickUpTaskRow {
  task_name:             string
  current_status:        string | null
  time_estimate_minutes: number | null
  task_archived:         boolean | null
}

export interface PhaseInference {
  /** Per-phase 0-1 progress derived from completed-task-hours over
   *  total-task-hours. Empty object when no tasks match. */
  perPhase:                 PhaseProgress
  /** Σ time_estimate_minutes of incomplete engaged tasks, per phase. */
  perPhaseRemainingMinutes: Partial<Record<WebProjectPhase, number>>
  /** Σ time_estimate_minutes of complete tasks, per phase. The
   *  "what's actually shipped" signal — independent of how the team
   *  uses the Open/Engaged status convention. */
  perPhaseCompletedMinutes: Partial<Record<WebProjectPhase, number>>
  /** Σ time_estimate_minutes of all engaged tasks, per phase. */
  perPhaseTotalMinutes:     Partial<Record<WebProjectPhase, number>>
  /** Σ time_estimate_minutes of non-complete tasks across all phases. */
  remainingMinutes:         number
  /** Σ time_estimate_minutes for all engaged tasks (complete + not). */
  totalMinutes:             number
  /** Total engaged task count across all phases. */
  totalTasks:               number
  /** Tasks that didn't match any phase pattern — useful for debugging
   *  the keyword table when something looks off. */
  unclassifiedNames:        string[]
  /** Tasks excluded as parent-bucket umbrella rows. Tracked so the
   *  user sees them filtered out instead of silently dropped. */
  excludedBucketNames:      string[]
}

// "Complete" statuses — case-insensitive. ClickUp uses lowercase
// "complete" for the closed state.
const COMPLETE_STATUSES = new Set(['complete', 'closed', 'done'])

// Statuses that indicate the team is actively engaged with this
// task (or has finished it). Mosaic-style task lists carry hundreds
// of "Open" template stubs from initial setup; the team never
// touched most of them. Treating "Open" as "to do" inflates the
// remaining-hours estimate by 10x. Only ACTIVE + COMPLETE statuses
// count toward inference.
const ENGAGED_STATUSES = new Set([
  'complete', 'closed', 'done',
  'in progress', 'received', 'ready to start',
  'sqd review', 'needs an update', 'waiting feedback',
  'dependent', 'in_revision', 'more info need',
])

// Parent / umbrella tasks that hold sub-tasks but don't represent
// actual work themselves. Counting them double-counts the phase.
// Match by exact lowercase normalization (whitespace collapsed).
const BUCKET_NAME_PATTERNS: RegExp[] = [
  /^website redesign$/i,
  /^website refresh$/i,
  /^website[: ]+final$/i,
  /^web[: ]+site refresh$/i,
  /^current site refresh$/i,
  /^microsite$/i,
  /^microsite build$/i,
  /^microsite design$/i,
  /^lessons learned[: ]+website redesign$/i,
]

function isBucketTask(name: string): boolean {
  const norm = name.replace(/\s+/g, ' ').trim()
  return BUCKET_NAME_PATTERNS.some(p => p.test(norm))
}

// Phase-by-keyword. Order matters: the FIRST matching pattern wins,
// so list specific patterns before generic ones. Review/launch are
// near the top so "Final Site Review" doesn't get caught by /design/
// or /build/ later. The intent: classify a task by the chunk of
// work it represents, NOT by a stray substring.
//
// New keywords go here — no schema changes needed.
const PHASE_KEYWORDS: Array<{ phase: WebProjectPhase; patterns: RegExp[] }> = [
  // Launch + post-launch — match before "review" so post-launch
  // training doesn't get bucketed as a review round.
  { phase: 'launched', patterns: [
    /\bsite launch\b/i, /\b^launch\b/i, /publish all pages/i,
    /post[- ]?launch/i, /post launch/i,
  ]},
  // Review — final QA + partner-facing test rounds.
  { phase: 'review', patterns: [
    /final site review/i, /^review[: ]/i, /internal review/i,
    /\bqa\b/i, /cross[- ]browser/i, /forms? testing/i,
    /functionality.*testing/i, /resign code/i,
    /walkthrough guide/i, /wordpress walkthrough/i,
  ]},
  // Dev / build — Josh's serial work. Keep this above "design" so
  // "Innerpage Build" / "Mega-Menu Build" don't get caught by
  // overly-broad design patterns.
  { phase: 'dev', patterns: [
    /\bbuild\b/i, /wordpress(?! walkthrough)/i, /plugins?/i,
    /mega[- ]menu/i, /provision/i, /hosting migration/i,
    /hosting setup/i, /archive template/i, /post type/i,
    /\bseo (sweep|setup)/i, /merch store/i, /theme restyling/i,
    /\b(theme|css|markup)\b/i, /developer notes.*handoff/i,
    /developer prep/i, /developer prep & build/i,
  ]},
  // Design — Figma + style guide + mockups.
  { phase: 'design', patterns: [
    /\bdesign\b/i, /\bfigma\b/i, /mood board/i, /style guide/i,
    /mockup/i, /homepage edits/i, /designer prep/i, /design refresh/i,
  ]},
  // Content / copywriting — outlines + drafts + sitemap planning.
  // "Page outline" / "create sitemap" before /design/ caught any
  // strays — keep them here, not in design.
  { phase: 'content', patterns: [
    /copywriting/i, /\bcopy\b/i, /copy refresh/i, /\bsitemap\b/i,
    /page outline/i, /strategy brief/i, /branding review/i,
    /style guide outline/i, /content collection.*review/i,
    /innerpage copy/i, /homepage copy/i,
  ]},
  // Intake — onboarding, audits, prefill, hosting timeline confirms.
  { phase: 'intake', patterns: [
    /onboarding/i, /web support/i, /content collection/i,
    /contentsnare/i, /google analytics/i, /ga tracking/i,
    /admin access/i, /current site audit/i, /site audit/i,
    /current site/i, /confirm hosting/i, /queue approval/i,
    /lessons learned/i, /photo compiling/i,
  ]},
]

function isComplete(status: string | null | undefined): boolean {
  if (!status) return false
  return COMPLETE_STATUSES.has(status.toLowerCase().trim())
}

function isEngaged(status: string | null | undefined): boolean {
  if (!status) return false
  return ENGAGED_STATUSES.has(status.toLowerCase().trim())
}

/** Best-effort phase categorization. Returns null when no pattern
 *  matches; the caller can record it as unclassified. */
export function classifyTaskByPhase(name: string): WebProjectPhase | null {
  for (const group of PHASE_KEYWORDS) {
    for (const p of group.patterns) {
      if (p.test(name)) return group.phase
    }
  }
  return null
}

export function inferProgressFromTasks(rows: ClickUpTaskRow[]): PhaseInference {
  // Three filters:
  //   • archived  — completed-and-closed or removed; never counts.
  //   • not engaged — "Open" template stubs the team never touched.
  //   • bucket — "Website Redesign" / "Microsite Build" / etc. are
  //     parent umbrella tasks that hold sub-tasks but don't carry
  //     real work. Counting them double-counts the phase.
  const excludedBucketNames: string[] = []
  const active = rows.filter(r => {
    if (r.task_archived) return false
    if (!isEngaged(r.current_status)) return false
    if (isBucketTask(r.task_name)) {
      excludedBucketNames.push(r.task_name)
      return false
    }
    return true
  })

  const perPhaseTotals    : Partial<Record<WebProjectPhase, number>> = {}
  const perPhaseCompleteWt: Partial<Record<WebProjectPhase, number>> = {}
  const perPhaseCompleteEst: Partial<Record<WebProjectPhase, number>> = {}
  const perPhaseRemaining : Partial<Record<WebProjectPhase, number>> = {}
  let remainingMinutes = 0
  let totalMinutes     = 0
  const unclassifiedNames: string[] = []

  for (const r of active) {
    const phase = classifyTaskByPhase(r.task_name)
    const est = Number(r.time_estimate_minutes ?? 0)
    totalMinutes += est
    const done = isComplete(r.current_status)
    if (!done) remainingMinutes += est
    if (!phase) {
      unclassifiedNames.push(r.task_name)
      continue
    }
    // Weighted progress uses max(est, 1) so 0-estimate tasks still
    // contribute equally to the bar fill. But the actual minutes
    // (`est`) are tracked separately for completed/remaining sums.
    const weight = Math.max(est, 1)
    perPhaseTotals[phase] = (perPhaseTotals[phase] ?? 0) + weight
    if (done) {
      perPhaseCompleteWt[phase]  = (perPhaseCompleteWt[phase]  ?? 0) + weight
      perPhaseCompleteEst[phase] = (perPhaseCompleteEst[phase] ?? 0) + est
    } else if (est > 0) {
      perPhaseRemaining[phase] = (perPhaseRemaining[phase] ?? 0) + est
    }
  }

  const perPhase: PhaseProgress = {}
  for (const [phase, total] of Object.entries(perPhaseTotals)) {
    const t = Number(total ?? 0)
    if (t <= 0) continue
    const c = Number(perPhaseCompleteWt[phase as WebProjectPhase] ?? 0)
    perPhase[phase as WebProjectPhase] = Math.min(1, c / t)
  }

  return {
    perPhase,
    perPhaseRemainingMinutes: perPhaseRemaining,
    perPhaseCompletedMinutes: perPhaseCompleteEst,
    perPhaseTotalMinutes:     perPhaseTotals,
    remainingMinutes,
    totalMinutes,
    totalTasks: active.length,
    unclassifiedNames,
    excludedBucketNames,
  }
}

/** Best-shot "remaining DEV hours" from inference.
 *
 *  Anchors on `dev_hours_estimate - completed_dev_minutes/60` so a
 *  project whose dev work hasn't started yet (most tasks in "Open"
 *  template state, filtered out) doesn't read 0h remaining. The
 *  team's CSV-imported estimate IS the planned total; inference
 *  tells us what's actually shipped against it.
 *
 *  Falls back to engaged-only inferred remaining when no estimate
 *  exists, and returns null when there's no signal at all.
 *
 *  @param inf     PhaseInference from `inferProgressFromTasks`
 *  @param devEst  dev_hours_estimate from the project row
 */
export function inferredDevRemainingHours(
  inf: PhaseInference,
  devEst?: number | null,
): number | null {
  const completedMin = Number(inf.perPhaseCompletedMinutes.dev ?? 0)
  const completedHours = completedMin / 60
  if (devEst != null && devEst > 0) {
    // Estimate-anchored: planned total minus what's been completed.
    // Floor at 0 (over-completed projects don't get negative remainder).
    return Math.max(0, Math.round((devEst - completedHours) * 10) / 10)
  }
  // No estimate — fall back to engaged-only inferred remaining.
  const totalMin = Number(inf.perPhaseTotalMinutes.dev ?? 0)
  if (totalMin <= 0) return null
  const remMin = Number(inf.perPhaseRemainingMinutes.dev ?? 0)
  return Math.round((remMin / 60) * 10) / 10
}
