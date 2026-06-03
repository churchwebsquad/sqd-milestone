/**
 * Pure feasibility analysis for a single web project + a target
 * launch date the AM is proposing.
 *
 * Where `computeProjectHealth` answers "are we on track with the
 * current plan?" `computeProjectFeasibility` answers "could we hit
 * THIS new date if we adjusted these levers?"
 *
 * Returns the verdict + quantified levers so the AM-response
 * generator (Phase 7) can cite specific tradeoffs ("Turn on AI
 * design = -5 days"). All inputs are passed in; no I/O.
 */
import {
  computeProjectHealth,
  phaseFromMilestones,
  phaseRank,
  type HealthInputs,
  type HealthMilestoneRow,
  PHASE_ORDER,
} from './webProjectHealth'
import { daysBetween, fromIsoDate } from './dateRange'
import type {
  StrategyWebProject,
  WebProjectPhase,
  PhaseEstimates,
  AiAssistMultipliers,
  PhaseProgress,
} from '../types/database'

export type FeasibilityVerdict = 'achievable' | 'tight' | 'unachievable'
export type Confidence         = 'high' | 'medium' | 'low'

export type LeverKind =
  | 'reduce_pages'
  | 'shorten_partner_reviews'
  | 'add_capacity'
  | 'cut_scope_to_audit'

export interface Lever {
  lever:        LeverKind
  impactDays:   number               // positive = pulls launch earlier
  description:  string
  risk?:        'quality' | 'partner_relationship' | 'scope'
}

export interface FeasibilityResult {
  verdict:                  FeasibilityVerdict
  confidence:               Confidence
  /** Projected launch with the CURRENT plan, no levers pulled. */
  projectedLaunch:          string | null
  /** Calendar gap (positive = before target, negative = after). */
  targetGapDays:            number | null
  remainingHoursAdjusted:   number
  availableHoursToTarget:   number
  bottleneckPhase:          WebProjectPhase | null
  leversAvailable:          Lever[]
  reasoning:                string[]
}

export interface FeasibilityInputs {
  project: Pick<
    StrategyWebProject,
    'id' | 'current_phase' | 'launch_date' | 'phase_estimates' |
    'ai_assist_multipliers' | 'dev_hours_estimate' | 'archived' |
    'phase_progress' | 'manual_remaining_hours'
  >
  milestones:          HealthMilestoneRow[]
  allocations:         Array<{ week_starting: string; hours: number }>
  joshWeeklyCapacity:  number
  today:               Date
  /** Hard target the AM is asking about. */
  targetDate:          string                     // ISO
  /** Optional — total pages on the project (used by the page-count
   *  lever). When omitted, page-related levers are suppressed. */
  pageCount?:          number
  /** Optional — count of completed projects to set confidence.
   *  ≥10 = high, 5–9 = medium, <5 = low. */
  completedProjectCount?: number
}

// Tunables — could move to strategy_app_config later. Keep the
// numbers conservative so we don't over-promise on speed-ups.
const SHORT_REVIEW_SAVING_DAYS   = 5       // skip one partner-review round
const REDUCE_PAGE_HOURS_PER_PAGE = 3.3     // 1.5 copy + 1.0 design + 0.8 dev
const ADD_CAPACITY_BONUS_HRS_PER_WEEK = 10 // adding a part-time helper

export function computeProjectFeasibility(i: FeasibilityInputs): FeasibilityResult {
  const target = fromIsoDate(i.targetDate)
  if (!target) {
    return emptyResult(`Couldn't parse target date "${i.targetDate}".`)
  }

  // Base case — the current plan's health.
  const health = computeProjectHealth({
    project: i.project,
    milestones: i.milestones,
    allocations: i.allocations,
    joshWeeklyCapacity: i.joshWeeklyCapacity,
    today: i.today,
  } as HealthInputs)

  // ── How much capacity sits between today and the AM's target? ──
  // Two sources: explicit per-project allocations (when the team has
  // staffed the project on the schedule), and a capacity-based fall-
  // back (Josh's full weekly hours times weeks-to-target). When no
  // allocations are entered we fall back to capacity so a small
  // remainder doesn't read "0h available" just because the schedule
  // grid is empty.
  let allocatedToTarget = 0
  for (const a of i.allocations) {
    const w = fromIsoDate(a.week_starting)
    if (!w) continue
    if (w < i.today) continue
    if (w > target) continue
    allocatedToTarget += Number(a.hours)
  }
  const daysToTarget = Math.max(0, daysBetween(i.today, target))
  const capacityToTarget = (daysToTarget / 7) * Math.max(i.joshWeeklyCapacity, 0)
  const availableToTarget = allocatedToTarget > 0
    ? allocatedToTarget
    : capacityToTarget

  // ── Verdict, confidence, gap ────────────────────────────
  const launchDate = fromIsoDate(i.project.launch_date)
  const projection = fromIsoDate(health.launchProjection)
  const reasoning: string[] = []

  const targetGapDays = projection ? daysBetween(projection, target) : null
  let verdict: FeasibilityVerdict
  if (health.subStatus === 'blocked') {
    verdict = 'unachievable'
    reasoning.push('Project is currently blocked; unblock before promising the new date.')
  } else if (
    targetGapDays != null
    && targetGapDays >= 0
    && health.remainingHoursAdjusted <= availableToTarget
  ) {
    // Projection lands on or before the target AND capacity covers
    // the work — call it achievable. Removes the old 7-day cushion
    // that wrote off small-remainder projects ("4h needed, 28h
    // available, 5d cushion") as merely tight.
    verdict = 'achievable'
    if (targetGapDays > 0) {
      reasoning.push(`Current plan projects ${formatDate(projection)} — ${targetGapDays}d before target.`)
    } else {
      reasoning.push(`Current plan projects ${formatDate(projection)} — lands on the target.`)
    }
  } else if (
    health.remainingHoursAdjusted <= availableToTarget * 1.1
    && (targetGapDays == null || targetGapDays >= -3)
  ) {
    verdict = 'tight'
    reasoning.push(
      `Plan needs ${health.remainingHoursAdjusted.toFixed(1)}h; available to target ${availableToTarget.toFixed(1)}h — tight but plausible.`,
    )
  } else {
    verdict = 'unachievable'
    reasoning.push(
      `Plan needs ${health.remainingHoursAdjusted.toFixed(1)}h but only ${availableToTarget.toFixed(1)}h are available by ${formatDate(target)}.`,
    )
  }

  const sample = i.completedProjectCount ?? 0
  const confidence: Confidence =
    sample >= 10 ? 'high'
    : sample >= 5  ? 'medium'
    :                'low'
  if (confidence === 'low') {
    reasoning.push(`Confidence: low — fewer than 5 completed projects to baseline from.`)
  }

  // ── Bottleneck phase ──────────────────────────────────────
  // "Bottleneck" = the phase that's actually consuming the remaining
  // work, NOT just the highest-estimate phase. Skip phases the team
  // has marked 100% complete via phase_progress — those can't bottle-
  // neck anything. When all remaining phases have zero estimate (the
  // user is leaning on manual_remaining_hours instead of per-phase
  // baselines), fall back to the EARLIEST not-100%-complete phase
  // since that's whatever the team is actively working on.
  const storedPhase = (i.project.current_phase || 'intake') as WebProjectPhase
  const milestonePhase = phaseFromMilestones(i.milestones)
  const effectivePhase: WebProjectPhase =
    (milestonePhase && phaseRank(milestonePhase) > phaseRank(storedPhase))
      ? milestonePhase
      : storedPhase
  const bottleneck = pickBottleneckPhase(
    effectivePhase,
    (i.project.phase_estimates ?? {}) as PhaseEstimates,
    (i.project.ai_assist_multipliers ?? {}) as AiAssistMultipliers,
    (i.project.phase_progress ?? {}) as PhaseProgress,
  )

  // ── Levers — only emit when there's actual headroom to gain.
  const levers: Lever[] = []
  const dayPerHour = (1 / Math.max(i.joshWeeklyCapacity, 1)) * 7  // calendar days saved per hour

  if (i.pageCount && i.pageCount > 10) {
    const reducible = Math.min(i.pageCount - 8, 4)               // cap suggestion at 4
    const hoursSaved = reducible * REDUCE_PAGE_HOURS_PER_PAGE
    const daysSaved  = Math.round(hoursSaved * dayPerHour)
    if (daysSaved > 0) {
      levers.push({
        lever: 'reduce_pages',
        impactDays: daysSaved,
        risk: 'scope',
        description: `Reduce scope by ${reducible} pages (saves ~${hoursSaved.toFixed(0)}h, ${daysSaved}d). Requires partner buy-in.`,
      })
    }
  }

  if (verdict !== 'achievable') {
    levers.push({
      lever: 'shorten_partner_reviews',
      impactDays: SHORT_REVIEW_SAVING_DAYS,
      risk: 'quality',
      description: `Skip one partner-review round (saves ~${SHORT_REVIEW_SAVING_DAYS}d). Quality risk — fewer eyes on the work.`,
    })
    levers.push({
      lever: 'add_capacity',
      impactDays: weeksToTarget(target, i.today, 4) * Math.round(ADD_CAPACITY_BONUS_HRS_PER_WEEK * dayPerHour),
      description: `Add a part-time helper for ~${ADD_CAPACITY_BONUS_HRS_PER_WEEK}h/week (saves ~${weeksToTarget(target, i.today, 4) * Math.round(ADD_CAPACITY_BONUS_HRS_PER_WEEK * dayPerHour)}d). Cost + onboarding overhead.`,
    })
  }

  if (verdict === 'unachievable' && effectivePhase === 'intake') {
    levers.push({
      lever: 'cut_scope_to_audit',
      impactDays: 30,                                            // rough
      risk: 'scope',
      description: 'Convert to an Audit engagement instead of a full redesign — drops scope to roughly 4 weeks total.',
    })
  }

  return {
    verdict,
    confidence,
    projectedLaunch:        health.launchProjection,
    targetGapDays,
    remainingHoursAdjusted: health.remainingHoursAdjusted,
    availableHoursToTarget: round1(availableToTarget),
    bottleneckPhase:        bottleneck,
    leversAvailable:        levers,
    reasoning,
  }

  function emptyResult(reason: string): FeasibilityResult {
    return {
      verdict: 'unachievable',
      confidence: 'low',
      projectedLaunch: null,
      targetGapDays: null,
      remainingHoursAdjusted: 0,
      availableHoursToTarget: 0,
      bottleneckPhase: null,
      leversAvailable: [],
      reasoning: [reason],
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

function pickBottleneckPhase(
  current: WebProjectPhase,
  est: PhaseEstimates,
  mults: AiAssistMultipliers,
  progress: PhaseProgress,
): WebProjectPhase | null {
  const rank = (p: WebProjectPhase) => PHASE_ORDER.indexOf(p)
  const isDone = (p: WebProjectPhase) => Number(progress[p] ?? 0) >= 1
  // Only phases at-or-after current AND not 100% complete are eligible.
  const candidates = PHASE_ORDER.filter(p =>
    p !== 'launched' && rank(p) >= rank(current) && !isDone(p),
  )
  if (candidates.length === 0) return null

  // Prefer the phase with the largest residual work (estimate × mult
  // × (1 - progress)). Ties broken by lower rank (earlier phase wins
  // — that's what's actively blocking).
  let bestPhase: WebProjectPhase = candidates[0]
  let bestHours = -Infinity
  for (const p of candidates) {
    const residual = (est[p] ?? 0) * (mults[p] ?? 1)
                   * (1 - Number(progress[p] ?? 0))
    if (residual > bestHours) { bestHours = residual; bestPhase = p }
  }
  // No phase carries non-zero residual hours (the team is leaning on
  // manual_remaining_hours) — pick the earliest not-done phase since
  // that's where work is actually happening right now.
  if (bestHours <= 0) return candidates[0]
  return bestPhase
}

function weeksToTarget(target: Date, today: Date, cap = 26): number {
  const ms = target.getTime() - today.getTime()
  return Math.max(0, Math.min(cap, Math.round(ms / (7 * 24 * 60 * 60 * 1000))))
}

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
