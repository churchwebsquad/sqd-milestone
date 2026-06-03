/**
 * Pure health math for a Website Manager project row.
 *
 * `computeProjectHealth` takes everything it needs as inputs — the
 * project row, its milestone submissions, its future weekly
 * allocations, and Josh's default weekly capacity — and returns a
 * single derived view-model the Board view + side panel render.
 *
 * No Supabase imports. No date-time-of-day reasoning beyond what
 * dateRange.ts provides. Testable in isolation; the hook
 * useProjectsWithHealth wraps the data loads.
 *
 * Algorithm (matches the plan):
 *   • effectiveHours(phase) = phase_estimates[phase] *
 *                             (ai_assist_multipliers[phase] ?? 1.0)
 *   • remaining = Σ effectiveHours for phases at-or-after current_phase
 *   • availableHoursToTarget = Σ allocations between today and launch_date
 *     (only this project's slice; cross-project contention is
 *     pre-baked because the allocations list is filtered upstream).
 *   • complete    when current_phase = 'launched'
 *   • blocked     when ANY active milestone is escalated, or
 *                 waiting_on_partner with submitted_at > 7d ago
 *   • off_track   when remaining > availableHoursToTarget
 *   • ahead       when remaining * 1.2 < availableHoursToTarget
 *   • on_track    otherwise
 */

import { daysBetween, fromIsoDate, toIsoDate, weeksBetween } from './dateRange'
import type {
  StrategyWebProject,
  ProjectSubStatus,
  WebProjectPhase,
  PhaseEstimates,
  AiAssistMultipliers,
  StrategyMilestoneSubmission,
} from '../types/database'

export const PHASE_ORDER: WebProjectPhase[] = [
  'intake', 'content', 'design', 'dev', 'review', 'launched',
]

export function phaseRank(p: WebProjectPhase | string | null | undefined): number {
  switch (p) {
    case 'intake':   return 1
    case 'content':  return 2
    case 'design':   return 3
    case 'dev':      return 4
    case 'review':   return 5
    case 'launched': return 6
    default:         return 0
  }
}

/** Milestone fields the health calc reads. Keep this loose so callers
 *  don't have to fetch the whole row. */
export type HealthMilestoneRow = Pick<
  StrategyMilestoneSubmission,
  'milestone_id' | 'milestone_status' | 'submitted_at'
>

export interface HealthInputs {
  project: Pick<
    StrategyWebProject,
    'id' | 'current_phase' | 'launch_date' | 'phase_estimates' |
    'ai_assist_multipliers' | 'dev_hours_estimate' | 'archived'
  >
  /** Active submissions for this project's member, newest first.
   *  Caller filters by `is_active=true` if relevant. */
  milestones: HealthMilestoneRow[]
  /** Future weekly allocations for THIS project (week_starting >= today).
   *  Sum used as availableHoursToTarget. */
  allocations: Array<{ week_starting: string; hours: number }>
  /** Default weekly capacity for Josh-the-dev. Lets the math factor
   *  in vacation overrides downstream if the caller wants. */
  joshWeeklyCapacity: number
  today: Date
}

export interface HealthResult {
  phase: WebProjectPhase
  subStatus: ProjectSubStatus
  /** ISO yyyy-mm-dd — when we project the project actually launches. */
  launchProjection: string | null
  /** Calendar gap (positive = days before launch_date, negative = after). */
  targetGapDays: number | null
  /** Hours required to reach launch from current_phase, with AI
   *  multipliers applied. */
  remainingHoursAdjusted: number
  /** Sum of this project's weekly allocations between today and
   *  launch_date. */
  availableHoursToTarget: number
  /** Human-readable bullets the side panel + AM response generator
   *  surface. Always non-empty so the strategist sees reasoning. */
  riskReasons: string[]
}

const BLOCKED_WAITING_DAYS = 7
const AHEAD_SLACK_FACTOR = 1.2

export function computeProjectHealth(i: HealthInputs): HealthResult {
  const phase = (i.project.current_phase || 'intake') as WebProjectPhase
  const phaseEst: PhaseEstimates = i.project.phase_estimates ?? {}
  const multipliers: AiAssistMultipliers = i.project.ai_assist_multipliers ?? {}
  const today = i.today
  const reasons: string[] = []

  // ── Complete short-circuit ───────────────────────────────
  if (phase === 'launched') {
    return {
      phase,
      subStatus: 'complete',
      launchProjection: i.project.launch_date,
      targetGapDays: null,
      remainingHoursAdjusted: 0,
      availableHoursToTarget: 0,
      riskReasons: ['Launched'],
    }
  }

  // ── Effective remaining hours ────────────────────────────
  const currentRank = phaseRank(phase)
  let remaining = 0
  for (const p of PHASE_ORDER) {
    if (phaseRank(p) < currentRank) continue
    if (p === 'launched') continue                   // terminal, no work
    const base = Number(phaseEst[p] ?? 0)
    const mult = clampMultiplier(multipliers[p])
    remaining += base * mult
  }

  // Fallback when phase_estimates is empty (project not yet sized):
  // distribute dev_hours_estimate across remaining phases evenly.
  if (remaining === 0 && i.project.dev_hours_estimate) {
    const phasesLeft = PHASE_ORDER.filter(p =>
      phaseRank(p) >= currentRank && p !== 'launched',
    ).length
    if (phasesLeft > 0) {
      remaining = Number(i.project.dev_hours_estimate)
      reasons.push(
        `Estimate is unphased — using overall dev_hours_estimate (${remaining}h).`,
      )
    }
  }

  // ── Available capacity to target ─────────────────────────
  const launchDate = fromIsoDate(i.project.launch_date)
  let availableHours = 0
  if (launchDate) {
    for (const a of i.allocations) {
      const w = fromIsoDate(a.week_starting)
      if (!w) continue
      if (w < today) continue
      if (w > launchDate) continue
      availableHours += Number(a.hours)
    }
  }

  // ── Blocked check ────────────────────────────────────────
  let blocked = false
  for (const m of i.milestones) {
    if (m.milestone_status === 'escalated') {
      blocked = true
      reasons.push(`Escalated milestone since ${fmtDate(m.submitted_at)}`)
    }
    if (m.milestone_status === 'waiting_on_partner') {
      const sent = fromIsoDate(m.submitted_at)
      if (sent && daysBetween(sent, today) > BLOCKED_WAITING_DAYS) {
        blocked = true
        reasons.push(`Waiting on partner since ${fmtDate(m.submitted_at)}`)
      }
    }
  }

  // ── Sub-status determination ─────────────────────────────
  let subStatus: ProjectSubStatus
  if (blocked) {
    subStatus = 'blocked'
  } else if (remaining > availableHours) {
    subStatus = 'off_track'
    if (availableHours > 0) {
      reasons.push(
        `Remaining ${remaining.toFixed(1)}h exceeds available ${availableHours.toFixed(1)}h to launch.`,
      )
    } else if (launchDate) {
      reasons.push(
        `No dev hours allocated between today and ${fmtDate(i.project.launch_date)}.`,
      )
    } else {
      reasons.push('No launch date set — projection unavailable.')
    }
  } else if (remaining * AHEAD_SLACK_FACTOR < availableHours) {
    subStatus = 'ahead'
    reasons.push(
      `Allocated ${availableHours.toFixed(1)}h covers ${remaining.toFixed(1)}h need with ${(((availableHours / Math.max(remaining, 1)) - 1) * 100).toFixed(0)}% slack.`,
    )
  } else {
    subStatus = 'on_track'
    if (remaining > 0) {
      reasons.push(
        `${remaining.toFixed(1)}h remaining, ${availableHours.toFixed(1)}h allocated to launch.`,
      )
    }
  }

  // ── Launch projection ────────────────────────────────────
  // Walk the allocation calendar forward from today, week by week,
  // until cumulative allocated hours covers `remaining`. The week
  // where it crosses over is the projected launch week.
  let projection: string | null = i.project.launch_date
  if (remaining > 0 && i.allocations.length > 0) {
    const sorted = [...i.allocations]
      .filter(a => {
        const w = fromIsoDate(a.week_starting)
        return w && w >= todayMidnight(today)
      })
      .sort((a, b) => a.week_starting.localeCompare(b.week_starting))
    let acc = 0
    for (const a of sorted) {
      acc += Number(a.hours)
      if (acc >= remaining) {
        projection = a.week_starting
        break
      }
    }
    // Ran out of allocations without satisfying remaining → no
    // projection from data alone; fall back to launch_date.
    if (acc < remaining && i.project.launch_date) {
      projection = i.project.launch_date
    }
  }

  // ── Calendar gap ─────────────────────────────────────────
  let gap: number | null = null
  if (launchDate && projection) {
    const projDate = fromIsoDate(projection)
    if (projDate) gap = daysBetween(projDate, launchDate)
  }

  return {
    phase,
    subStatus,
    launchProjection: projection,
    targetGapDays: gap,
    remainingHoursAdjusted: round1(remaining),
    availableHoursToTarget: round1(availableHours),
    riskReasons: reasons.length > 0 ? reasons : ['On baseline plan.'],
  }
}

// ── Helpers ───────────────────────────────────────────────

function clampMultiplier(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 1
  return Math.min(1, v)
}

function todayMidnight(today: Date): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate())
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = fromIsoDate(iso)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : iso
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export const _internal_for_tests = {
  todayMidnight, clampMultiplier, weeksBetween, toIsoDate,
}
