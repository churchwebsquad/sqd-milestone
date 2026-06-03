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
  perPhase:           PhaseProgress
  /** Σ time_estimate_minutes of non-complete tasks across all phases.
   *  Use as a fallback for `manual_remaining_hours`. */
  remainingMinutes:   number
  /** Σ time_estimate_minutes for all tasks (complete + not). */
  totalMinutes:       number
  /** Total task count across all phases. */
  totalTasks:         number
  /** Tasks that didn't match any phase pattern — useful for debugging
   *  the keyword table when something looks off. */
  unclassifiedNames:  string[]
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
  // Skip archived tasks entirely — they were either completed-and-
  // closed or removed; don't count them either way.
  // ALSO skip tasks still in default "Open" / "open" status. The
  // team uses "ready to start" for real to-do work; "Open" is just
  // a template stub from project setup that may or may not get
  // worked. Counting them all would 10x the remaining-hours number.
  const active = rows.filter(r =>
    !r.task_archived && isEngaged(r.current_status),
  )
  const perPhaseTotals  : Partial<Record<WebProjectPhase, number>> = {}
  const perPhaseComplete: Partial<Record<WebProjectPhase, number>> = {}
  let remainingMinutes = 0
  let totalMinutes     = 0
  const unclassifiedNames: string[] = []

  for (const r of active) {
    const phase = classifyTaskByPhase(r.task_name)
    // Even unclassified tasks contribute to the rough remaining-
    // minutes total. They just don't move any individual phase's bar.
    const est = Number(r.time_estimate_minutes ?? 0)
    totalMinutes += est
    if (!isComplete(r.current_status)) remainingMinutes += est
    if (!phase) {
      unclassifiedNames.push(r.task_name)
      continue
    }
    perPhaseTotals[phase]   = (perPhaseTotals[phase]   ?? 0) + Math.max(est, 1)
    if (isComplete(r.current_status)) {
      perPhaseComplete[phase] = (perPhaseComplete[phase] ?? 0) + Math.max(est, 1)
    }
  }

  const perPhase: PhaseProgress = {}
  for (const [phase, total] of Object.entries(perPhaseTotals)) {
    const t = Number(total ?? 0)
    if (t <= 0) continue
    const c = Number(perPhaseComplete[phase as WebProjectPhase] ?? 0)
    perPhase[phase as WebProjectPhase] = Math.min(1, c / t)
  }

  return {
    perPhase,
    remainingMinutes,
    totalMinutes,
    totalTasks: active.length,
    unclassifiedNames,
  }
}
