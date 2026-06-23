/**
 * Recovery solver — port of solveHelp from the prototype.
 *
 * For a behind-target site, finds the MINIMUM help-hours that recover
 * the target. Adds help one hour at a time to the eligible week with
 * the least help so far, re-runs the whole scheduler each iteration,
 * and stops when the site lands on target (or runs out of room).
 *
 * Three outcomes drive the UI:
 *   - RECOVERABLE  — adding `helpHours` recovers target by `date`.
 *   - LOCKED       — can't recover. Two reasons:
 *                      'dev-only' (recovery flag forbids offload)
 *                      'designer-out' (no eligible weeks have a
 *                       designer available).
 *   - INSUFFICIENT — maxed help-per-week on every eligible week and
 *                    still misses. Reports best achievable date.
 */
import {
  computeSchedule, parseD, weekStart, type SchedulerSite,
  type WeekAdjustment, type SchedulerConfig, type SiteSchedule,
  type HelpMap, type WeekFlag,
  buildHelpMap, buildDesignerOutMap, buildBlackoutMap, buildBaseCapMap,
} from './launchScheduler'

export type RecoveryState = 'on_time' | 'recoverable' | 'locked' | 'insufficient'
export type RecoveryLockReason = 'dev-only' | 'designer-out'

export interface RecoveryResult {
  state:      RecoveryState
  /** Only set when state === 'locked'. */
  reason?:    RecoveryLockReason
  /** Total extra help-hours required (recoverable) or attempted
   *  (insufficient). */
  helpHours?: number
  /** Per-week delta map (weekIndex → extra help to add ON TOP of
   *  whatever's already saved). Only set when state ∈ recoverable /
   *  insufficient. */
  perWeek?:   Record<number, number>
  /** Projected launch under the recovered allocation (or the current
   *  date when LOCKED). */
  date:       Date
  /** Days behind target BEFORE recovery (positive integer). */
  behind:     number
  /** Days still behind after maxing help (insufficient only). */
  stillLate?: number
}

/** Solve the minimum help to recover a single site. */
export function solveHelp(
  siteId:        string,
  sites:         SchedulerSite[],
  baseSchedule:  Record<string, SiteSchedule>,
  adjustments:   WeekAdjustment[],
  cfg:           SchedulerConfig,
): RecoveryResult {
  const base = baseSchedule[siteId]
  const site = sites.find(s => s.id === siteId)
  if (!base || !site || base.delta == null || base.delta >= 0) {
    return { state: 'on_time', date: base?.launchDate ?? new Date(), behind: 0 }
  }
  const behind = -base.delta

  // Gating condition (a): recovery mode must allow offload.
  if (site.recovery_mode === 'dev-only') {
    return {
      state:  'locked',
      reason: 'dev-only',
      date:   base.launchDate,
      behind,
    }
  }

  const helpMap0     = buildHelpMap(adjustments, cfg)
  const designerOut  = buildDesignerOutMap(adjustments, cfg)
  const blackout     = buildBlackoutMap(adjustments, cfg)
  const baseCap      = buildBaseCapMap(adjustments, cfg)

  // Gating condition (b): at least one week through the site's end
  // must be both non-blackout AND designer-available.
  const eligible: number[] = []
  for (let i = 0; i <= base.endWeek; i++) {
    if (blackout[i]) continue
    if (designerOut[i]) continue
    eligible.push(i)
  }
  if (eligible.length === 0) {
    return {
      state:  'locked',
      reason: 'designer-out',
      date:   base.launchDate,
      behind,
    }
  }

  // Incremental search — add 1 help-hour at a time to the eligible
  // week with the lowest current help (round-robin fill), re-run the
  // scheduler, stop when target hits.
  const trial: HelpMap = { ...helpMap0 }
  let added = 0
  const ceiling = eligible.length * cfg.max_help_per_week
  let last: SiteSchedule = base

  while (added < ceiling) {
    // Pick the eligible week with the least help so far that hasn't
    // hit max_help_per_week yet.
    let target = -1
    let min = Infinity
    for (const i of eligible) {
      const cur = trial[i] ?? 0
      if (cur < cfg.max_help_per_week && cur < min) {
        min = cur
        target = i
      }
    }
    if (target < 0) break

    trial[target] = (trial[target] ?? 0) + 1
    added++
    last = computeSchedule(sites, trial, designerOut, blackout, cfg, baseCap)[siteId] ?? last

    if (last.delta != null && last.delta >= 0) {
      return {
        state:     'recoverable',
        helpHours: added,
        perWeek:   diffHelp(trial, helpMap0, eligible),
        date:      last.launchDate,
        behind,
      }
    }
  }

  return {
    state:     'insufficient',
    helpHours: added,
    perWeek:   diffHelp(trial, helpMap0, eligible),
    date:      last.launchDate,
    behind,
    stillLate: last.delta != null ? -last.delta : behind,
  }
}

/** Solve recovery for every behind-target site, returning the map. */
export function solveAllHelp(
  sites:         SchedulerSite[],
  baseSchedule:  Record<string, SiteSchedule>,
  adjustments:   WeekAdjustment[],
  cfg:           SchedulerConfig,
): Record<string, RecoveryResult> {
  const out: Record<string, RecoveryResult> = {}
  for (const s of sites) {
    const slot = baseSchedule[s.id]
    if (!slot || slot.delta == null || slot.delta >= 0) continue
    out[s.id] = solveHelp(s.id, sites, baseSchedule, adjustments, cfg)
  }
  return out
}

function diffHelp(trial: HelpMap, baseline: HelpMap, eligible: number[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const i of eligible) {
    const d = (trial[i] ?? 0) - (baseline[i] ?? 0)
    if (d > 0) out[i] = d
  }
  return out
}

/** Apply a perWeek delta map onto an adjustments array, returning the
 *  rows the caller should upsert into strategy_dev_weekly_allocations.
 *  Used by "Apply help" buttons in the UI. */
export function applyRecoveryToAdjustments(
  perWeek:     Record<number, number>,
  adjustments: WeekAdjustment[],
  cfg:         SchedulerConfig,
): WeekAdjustment[] {
  // Build a lookup of existing adjustments by week_starting.
  const byWeek = new Map<string, WeekAdjustment>()
  for (const a of adjustments) byWeek.set(a.week_starting, a)

  const out: WeekAdjustment[] = []
  for (const [idxStr, delta] of Object.entries(perWeek)) {
    const i = Number(idxStr)
    const wk = weekStart(i, cfg)
    const iso = wk.toISOString().slice(0, 10)
    const existing = byWeek.get(iso)
    out.push({
      week_starting: iso,
      help_hours:    (existing?.help_hours ?? 0) + delta,
      designer_out:  existing?.designer_out ?? false,
      is_blackout:   existing?.is_blackout ?? false,
    })
  }
  return out
}

/** Pure helper: the date math anchor needs an import path consumers
 *  can reach without dipping into launchScheduler directly. */
export { parseD, weekStart } from './launchScheduler'
