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
  PhaseProgress,
  StrategyMilestoneSubmission,
} from '../types/database'

export const PHASE_ORDER: WebProjectPhase[] = [
  'intake', 'content', 'design', 'dev', 'review', 'launched',
]

/** Josh's dedicatable hours per week. Was 30; bumped to 32.75 per
 *  Ashley 2026-06-03 to reflect his actual schedule. Single source
 *  of truth — every health/feasibility callsite imports this. */
export const DEFAULT_DEV_CAPACITY = 32.75

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
 *  don't have to fetch the whole row. When the caller can supply
 *  squad/pathway/step_number, phaseFromMilestones() uses them to
 *  derive an effective phase that beats a stale stored current_phase
 *  (e.g. step 9 "Review: Final Website" sent → effective phase =
 *  'review' even if the project row still says 'intake'). */
export type HealthMilestoneRow = Pick<
  StrategyMilestoneSubmission,
  'milestone_id' | 'milestone_status' | 'submitted_at'
> & {
  squad?:       string | null
  pathway?:     string | null
  step_number?: number | null
}

/** Web-Redesign step number → project phase. Mirrors the
 *  strategy_web_phase_map seed from the original plan; lives in code
 *  for now since the table never landed. Other pathways (audit,
 *  refresh) get no mapping — their submissions don't move the phase. */
const WEB_REDESIGN_STEP_TO_PHASE: Record<number, WebProjectPhase> = {
  1: 'intake',
  2: 'content',  3: 'content',  4: 'content',  5: 'content',
  6: 'design',   7: 'design',
  8: 'dev',
  9: 'review',
 10: 'launched',
}

/** Highest phase implied by the partner's milestone submissions for
 *  the Web Redesign pathway. Returns null when no web-redesign
 *  submission exists. "Implied" = the milestone was sent or moved
 *  beyond — drafts don't count. */
export function phaseFromMilestones(
  milestones: HealthMilestoneRow[],
): WebProjectPhase | null {
  let best: WebProjectPhase | null = null
  let bestRank = 0
  for (const m of milestones) {
    if (m.squad !== 'web') continue
    if (m.pathway !== 'redesign') continue
    if (m.step_number == null) continue
    if (m.milestone_status === 'draft') continue
    const ph = WEB_REDESIGN_STEP_TO_PHASE[m.step_number]
    if (!ph) continue
    const r = phaseRank(ph)
    if (r > bestRank) { bestRank = r; best = ph }
  }
  return best
}

export interface HealthInputs {
  project: Pick<
    StrategyWebProject,
    'id' | 'current_phase' | 'launch_date' | 'phase_estimates' |
    'ai_assist_multipliers' | 'dev_hours_estimate' | 'archived' |
    'phase_progress' | 'manual_remaining_hours'
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
  const storedPhase = (i.project.current_phase || 'intake') as WebProjectPhase
  // Milestone-derived phase beats stored current_phase when it's
  // further along. So a project whose row still says 'intake' but
  // whose team has already sent "Review: Final Website" reads as
  // 'review' — which is what the team actually cares about.
  const milestonePhase = phaseFromMilestones(i.milestones)
  const phase: WebProjectPhase =
    (milestonePhase && phaseRank(milestonePhase) > phaseRank(storedPhase))
      ? milestonePhase
      : storedPhase
  const phaseEst: PhaseEstimates = i.project.phase_estimates ?? {}
  const multipliers: AiAssistMultipliers = i.project.ai_assist_multipliers ?? {}
  const today = i.today
  const reasons: string[] = []
  if (milestonePhase && milestonePhase !== storedPhase
      && phaseRank(milestonePhase) > phaseRank(storedPhase)) {
    reasons.push(`Phase ${milestonePhase} inferred from milestone submissions.`)
  }

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
  // Three sources, in priority order:
  //   1. manual_remaining_hours — explicit "trust me" override
  //   2. phase_estimates × (1 - phase_progress)   — when both present
  //   3. dev_hours_estimate × fraction_unstarted   — fallback
  //
  // The AI multipliers from v58 are still respected when no other
  // override is set, but the side panel no longer exposes them and
  // they default to 1.0 — keeping the math additive so existing
  // values don't break.
  const currentRank = phaseRank(phase)
  const progress: PhaseProgress = i.project.phase_progress ?? {}
  let remaining = 0

  if (typeof i.project.manual_remaining_hours === 'number'
      && i.project.manual_remaining_hours >= 0) {
    remaining = Number(i.project.manual_remaining_hours)
    reasons.push(
      `Using manual remaining override (${remaining}h).`,
    )
  } else {
    for (const p of PHASE_ORDER) {
      if (phaseRank(p) < currentRank) continue
      if (p === 'launched') continue                     // terminal, no work
      const base = Number(phaseEst[p] ?? 0)
      const mult = clampMultiplier(multipliers[p])
      const prog = clampProgress(progress[p])
      remaining += base * mult * (1 - prog)
    }

    // Fallback when phase_estimates is empty (project not yet
    // sized): distribute dev_hours_estimate across remaining
    // phases, reduced by the average progress on those phases.
    if (remaining === 0 && i.project.dev_hours_estimate) {
      const phasesLeft = PHASE_ORDER.filter(p =>
        phaseRank(p) >= currentRank && p !== 'launched',
      )
      if (phasesLeft.length > 0) {
        const avgProgress = phasesLeft.reduce(
          (s, p) => s + clampProgress(progress[p]), 0,
        ) / phasesLeft.length
        remaining = Number(i.project.dev_hours_estimate) * (1 - avgProgress)
        reasons.push(
          `Estimate is unphased — using dev_hours_estimate × ${(1 - avgProgress).toFixed(2)} = ${remaining.toFixed(1)}h.`,
        )
      }
    }
  }

  // ── Available capacity to target ─────────────────────────
  // Explicit per-project allocations first; when none are entered we
  // fall back to capacity-based hours (Josh's weekly hours × weeks
  // until launch). Without this fallback a partner with no schedule
  // grid entry reads "0h available" even though the dev's calendar
  // is wide open — which is exactly why a 4h-remainder project was
  // showing as "15 days behind."
  const launchDate = fromIsoDate(i.project.launch_date)
  let allocatedHours = 0
  if (launchDate) {
    for (const a of i.allocations) {
      const w = fromIsoDate(a.week_starting)
      if (!w) continue
      if (w < today) continue
      if (w > launchDate) continue
      allocatedHours += Number(a.hours)
    }
  }
  let availableHours = allocatedHours
  if (availableHours === 0 && launchDate) {
    const days = Math.max(0, daysBetween(today, launchDate))
    availableHours = (days / 7) * Math.max(i.joshWeeklyCapacity, 0)
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
  // Two independent estimates; the EARLIER of the two wins:
  //
  //   • Allocation-based — walk the project's future weekly
  //     allocations until cumulative hours covers `remaining`. The
  //     week where it crosses over is the booked projection.
  //   • Capacity-based — `today + ceil(remaining / capacity)` weeks.
  //     The "if Josh starts today and works straight through" number.
  //     Catches the case where allocations are sparse, missing, or
  //     stale, so a tiny remaining doesn't get pushed to whatever
  //     distant week happens to carry the first booking.
  //
  // We use the earlier of the two so a 10h remaining doesn't read
  // "ships in 12 months" just because someone scheduled hours that
  // far out.
  let projection: string | null = i.project.launch_date
  if (remaining > 0) {
    // Allocation-based candidate.
    let allocProjection: string | null = null
    if (i.allocations.length > 0) {
      const sorted = [...i.allocations]
        .filter(a => {
          const w = fromIsoDate(a.week_starting)
          return w && w >= todayMidnight(today)
        })
        .sort((a, b) => a.week_starting.localeCompare(b.week_starting))
      let acc = 0
      for (const a of sorted) {
        acc += Number(a.hours)
        if (acc >= remaining) { allocProjection = a.week_starting; break }
      }
    }

    // Capacity-based candidate — uses Josh's default weekly capacity
    // as the ceiling. If allocations exist they're typically less
    // than capacity (other projects sharing the week), so this is
    // an OPTIMISTIC estimate. It's the "best-case if we drop other
    // commitments" answer, useful as a sanity bound on the booked
    // projection.
    //
    // Math is in DAYS (not whole weeks) so a 4-hour remainder doesn't
    // push the projection a full week. ceil(remaining × 7 / capacity)
    // gives the smallest whole-day chunk that covers the work.
    const cap = Math.max(i.joshWeeklyCapacity, 1)
    const daysNeeded = Math.max(1, Math.ceil((remaining * 7) / cap))
    const capProjectionDate = new Date(today)
    capProjectionDate.setDate(capProjectionDate.getDate() + daysNeeded)
    const capProjection = toIsoDate(capProjectionDate)

    // Pick the EARLIER of the two when both exist; the allocation-
    // based one only wins when bookings are realistic.
    const candidates: string[] = []
    if (allocProjection) candidates.push(allocProjection)
    candidates.push(capProjection)
    candidates.sort()
    projection = candidates[0]

    if (allocProjection && capProjection < allocProjection) {
      reasons.push(
        `Booked allocations finish ${fmtDate(allocProjection)}, but ${remaining.toFixed(1)}h at ${cap}h/week could finish by ${fmtDate(capProjection)} if reshuffled.`,
      )
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

function clampProgress(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0
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
