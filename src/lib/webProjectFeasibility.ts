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
  type HealthInputs,
  type HealthMilestoneRow,
  PHASE_ORDER,
} from './webProjectHealth'
import { daysBetween, fromIsoDate, toIsoDate, weekStart } from './dateRange'
import type {
  StrategyWebProject,
  WebProjectPhase,
  PhaseEstimates,
  AiAssistMultipliers,
} from '../types/database'

export type FeasibilityVerdict = 'achievable' | 'tight' | 'unachievable'
export type Confidence         = 'high' | 'medium' | 'low'

export type LeverKind =
  | 'enable_ai_content'
  | 'enable_ai_design'
  | 'enable_ai_dev'
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
    'ai_assist_multipliers' | 'dev_hours_estimate' | 'archived'
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
const AI_CONTENT_SAVING_FRACTION = 0.50    // 50% of content phase saved
const AI_DESIGN_SAVING_FRACTION  = 0.30    // 30% of design phase saved
const AI_DEV_SAVING_FRACTION     = 0.10    // 10% of dev phase saved
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
  const targetIso = toIsoDate(weekStart(target))
  let availableToTarget = 0
  for (const a of i.allocations) {
    const w = fromIsoDate(a.week_starting)
    if (!w) continue
    if (w < i.today) continue
    if (w > target) continue
    availableToTarget += Number(a.hours)
  }

  // ── Verdict, confidence, gap ────────────────────────────
  const launchDate = fromIsoDate(i.project.launch_date)
  const projection = fromIsoDate(health.launchProjection)
  const reasoning: string[] = []

  const targetGapDays = projection ? daysBetween(projection, target) : null
  let verdict: FeasibilityVerdict
  if (targetGapDays != null && targetGapDays >= 7) {
    verdict = 'achievable'
    reasoning.push(`Current plan projects ${formatDate(projection)} — already ${targetGapDays}d before target.`)
  } else if (
    health.remainingHoursAdjusted <= availableToTarget * 1.1
    && health.subStatus !== 'blocked'
  ) {
    verdict = 'tight'
    reasoning.push(
      `Plan needs ${health.remainingHoursAdjusted.toFixed(1)}h; available to target ${availableToTarget.toFixed(1)}h — tight but plausible.`,
    )
  } else {
    verdict = 'unachievable'
    if (health.subStatus === 'blocked') {
      reasoning.push('Project is currently blocked; unblock before promising the new date.')
    } else {
      reasoning.push(
        `Plan needs ${health.remainingHoursAdjusted.toFixed(1)}h but only ${availableToTarget.toFixed(1)}h are allocated by ${formatDate(target)}.`,
      )
    }
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
  const bottleneck = pickBottleneckPhase(
    (i.project.current_phase || 'intake') as WebProjectPhase,
    (i.project.phase_estimates ?? {}) as PhaseEstimates,
    (i.project.ai_assist_multipliers ?? {}) as AiAssistMultipliers,
  )

  // ── Levers — only emit when there's actual headroom to gain.
  const levers: Lever[] = []
  const mults = (i.project.ai_assist_multipliers ?? {}) as AiAssistMultipliers
  const phaseEst = (i.project.phase_estimates ?? {}) as PhaseEstimates
  const dayPerHour = (1 / Math.max(i.joshWeeklyCapacity, 1)) * 7  // calendar days saved per hour

  const tryLeverAi = (phase: WebProjectPhase, fraction: number, kind: LeverKind, label: string) => {
    const current = mults[phase] ?? 1.0
    if (current < 0.99) return                                   // already on
    const baseline = phaseEst[phase] ?? 0
    if (baseline <= 0) return
    const hoursSaved = baseline * fraction
    const daysSaved  = Math.round(hoursSaved * dayPerHour)
    if (daysSaved <= 0) return
    levers.push({
      lever: kind,
      impactDays: daysSaved,
      description: `Turn on AI ${label} — cuts ${label} hours by ~${Math.round(fraction * 100)}% (saves ~${hoursSaved.toFixed(0)}h, ${daysSaved}d).`,
    })
  }
  tryLeverAi('content', AI_CONTENT_SAVING_FRACTION, 'enable_ai_content', 'copywriting')
  tryLeverAi('design',  AI_DESIGN_SAVING_FRACTION,  'enable_ai_design',  'design')
  tryLeverAi('dev',     AI_DEV_SAVING_FRACTION,     'enable_ai_dev',     'dev')

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

  if (verdict === 'unachievable' && (i.project.current_phase as WebProjectPhase) === 'intake') {
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
): WebProjectPhase | null {
  const rank = (p: WebProjectPhase) =>
    PHASE_ORDER.indexOf(p)
  let bestPhase: WebProjectPhase | null = null
  let bestHours = -Infinity
  for (const p of PHASE_ORDER) {
    if (p === 'launched') continue
    if (rank(p) < rank(current)) continue
    const h = (est[p] ?? 0) * (mults[p] ?? 1)
    if (h > bestHours) { bestHours = h; bestPhase = p }
  }
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
