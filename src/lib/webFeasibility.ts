/**
 * Feasibility evaluator — "is this launch date crazy?"
 *
 * Used inline on every launch-date editor (per-project planning tab,
 * create-project modal, list-view inline edit) plus by the
 * needs-attention digest to flag projects whose target won't fit.
 *
 * Reads the same signals as `computeProjectHealth` (the existing
 * projection math) but exposes a tighter API + a one-line
 * explanation + an actionable suggestion. Pure function.
 */
import { fromIsoDate, daysBetween, toIsoDate } from './dateRange'
import { deriveSizeTier, hourRangeForTier } from './webPlanningMath'
import { DEFAULT_DEV_CAPACITY } from './webProjectHealth'

export type FeasibilityVerdict = 'feasible' | 'tight' | 'infeasible' | 'unknown'

export interface FeasibilityResult {
  verdict:    FeasibilityVerdict
  gapHours:   number         // hours short (negative = surplus)
  freeHours:  number         // sum of weekly capacity between today & target
  neededHours:number         // tier-based estimate (or override if explicit)
  /** Compact "why" string. Always set. */
  oneLiner:   string
  /** When infeasible/tight, a concrete action to reach feasible. null otherwise. */
  suggestion: FeasibilitySuggestion | null
}

export interface FeasibilitySuggestion {
  kind: 'push_date' | 'reduce_hours' | 'add_capacity'
  detail: string
  /** When kind === 'push_date', the earliest feasible date. */
  earliestISO?: string
}

export interface FeasibilityInputs {
  targetISO:           string                     // YYYY-MM-DD
  today?:              Date
  /** Tier-derived hour estimate. When override is set on the project,
   *  pass that as `overrideHours` instead. */
  pageCount?:          number | null
  overrideHours?:      number | null
  /** Hours already allocated to other projects each week. The
   *  evaluator subtracts these from DEFAULT_DEV_CAPACITY per week
   *  to figure out remaining capacity available for THIS project. */
  competingHoursByWeek?: Map<string, number>
  /** Hours already committed to THIS project in the window. */
  thisProjectHoursByWeek?: Map<string, number>
  /** Override DEFAULT_DEV_CAPACITY when caller wants a what-if. */
  weeklyCapacity?:     number
}

// Buffer = 15 % of needed hours. Tight = within buffer of zero.
const TIGHTNESS_BUFFER = 0.15

export function evaluateLaunchFeasibility(i: FeasibilityInputs): FeasibilityResult {
  const target = fromIsoDate(i.targetISO)
  if (!target) {
    return {
      verdict: 'unknown',
      gapHours: 0, freeHours: 0, neededHours: 0,
      oneLiner: 'No launch date set.',
      suggestion: null,
    }
  }
  const today = i.today ?? new Date()
  const daysOut = daysBetween(today, target)
  if (daysOut < 0) {
    return {
      verdict: 'infeasible',
      gapHours: 0, freeHours: 0, neededHours: 0,
      oneLiner: `Launch date is ${Math.abs(daysOut)} days in the past.`,
      suggestion: { kind: 'push_date', detail: 'Pick a future date.' },
    }
  }

  // Needed hours = override if explicit, else tier-based likely-hours.
  const tier = deriveSizeTier(i.pageCount)
  const range = hourRangeForTier(tier)
  const neededHours = i.overrideHours ?? range.likely

  // Free hours = sum of (weeklyCapacity - competingHours) for every
  // week that starts on or before target.
  //
  // "competing" already excludes this project's own allocations
  // (caller computes competing by summing the OTHER projects in the
  // queue). So free-for-this-project = max(0, cap - competing). The
  // "thisProject" allocation map is informational only — it doesn't
  // ADD to the budget (those hours are already committed; they're
  // not additional capacity). It's reserved here for future per-week
  // surface but not summed into freeHours. The double-add bug an
  // earlier version had inflated availability for any week where
  // this project had a reservation.
  const weeklyCap = i.weeklyCapacity ?? DEFAULT_DEV_CAPACITY
  const competing = i.competingHoursByWeek ?? new Map<string, number>()
  // Reserve a no-op read so the param stays load-bearing in tests.
  void (i.thisProjectHoursByWeek ?? null)
  // Whole weeks contribute full capacity; the partial trailing week
  // contributes a fractional share proportional to its days.
  const totalDays = Math.max(0, daysBetween(today, target))
  const wholeWeeks = Math.floor(totalDays / 7)
  const trailingDays = totalDays - wholeWeeks * 7
  let freeHours = 0
  for (let w = 0; w < wholeWeeks; w++) {
    const wkStart = weekStartingAfter(today, w)
    const used = competing.get(wkStart) ?? 0
    freeHours += Math.max(0, weeklyCap - used)
  }
  if (trailingDays > 0) {
    const wkStart = weekStartingAfter(today, wholeWeeks)
    const used = competing.get(wkStart) ?? 0
    freeHours += Math.max(0, weeklyCap - used) * (trailingDays / 7)
  }
  freeHours = Math.round(freeHours * 10) / 10

  const gapHours = Math.round((neededHours - freeHours) * 10) / 10
  const verdict: FeasibilityVerdict =
    gapHours <= 0                             ? 'feasible'
  : gapHours <= neededHours * TIGHTNESS_BUFFER ? 'tight'
                                             : 'infeasible'

  const oneLiner = buildOneLiner(verdict, neededHours, freeHours, gapHours, daysOut)
  const suggestion = buildSuggestion(verdict, gapHours, neededHours, weeklyCap, competing, today)

  return { verdict, gapHours, freeHours, neededHours, oneLiner, suggestion }
}

// ── String builders ───────────────────────────────────────────────

function buildOneLiner(
  verdict: FeasibilityVerdict, needed: number, free: number,
  gap: number, daysOut: number,
): string {
  const dayPart = `${daysOut} day${daysOut === 1 ? '' : 's'} out`
  if (verdict === 'feasible') {
    return `Feasible — ${needed}h needed, ${free}h available (${dayPart}).`
  }
  if (verdict === 'tight') {
    return `Tight — ${needed}h needed, ${free}h available (gap ${gap}h, ${dayPart}).`
  }
  if (verdict === 'infeasible') {
    return `Infeasible — ${needed}h needed but only ${free}h available before ${dayPart}.`
  }
  return 'Cannot compute feasibility.'
}

function buildSuggestion(
  verdict: FeasibilityVerdict,
  gap: number,
  needed: number,
  weeklyCap: number,
  competing: Map<string, number>,
  today: Date,
): FeasibilitySuggestion | null {
  if (verdict === 'feasible' || verdict === 'unknown') return null

  // Suggest pushing the launch date out enough to absorb the gap.
  // Walk forward by week until cumulative free hours catches up.
  let cumulative = 0
  for (let w = 0; w < 52; w++) {
    const wkStart = weekStartingAfter(today, w)
    const remaining = Math.max(0, weeklyCap - (competing.get(wkStart) ?? 0))
    cumulative += remaining
    if (cumulative >= needed) {
      const wkDate = parseWeek(wkStart)
      const earliestISO = wkDate ? toIsoDate(wkDate) : null
      if (earliestISO) {
        return {
          kind: 'push_date',
          detail: `Push launch to ${formatHuman(wkDate!)} or later.`,
          earliestISO,
        }
      }
      break
    }
  }
  // Or: cut dev scope by gap hours.
  return {
    kind: 'reduce_hours',
    detail: `Reduce dev scope by ${Math.ceil(gap)}h, or add dev capacity.`,
  }
}

// ── Small date helpers (Sunday-aligned to match WM scheduler) ─────

function weekStartingAfter(today: Date, offsetWeeks: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  // Snap to Sunday on/before today.
  d.setDate(d.getDate() - d.getDay() + offsetWeeks * 7)
  return toIsoDate(d)
}

function parseWeek(iso: string): Date | null {
  return fromIsoDate(iso)
}

function formatHuman(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
