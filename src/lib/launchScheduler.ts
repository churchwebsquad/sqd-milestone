/**
 * Launch scheduler — day-level simulation with phased build flow.
 *
 * Mental model:
 *   - Each site decomposes into three segments:
 *       build  → main development (consumes dev capacity)
 *       review → out with the partner (calendar pause, dev pivots)
 *       final  → final edits + launch (consumes dev capacity)
 *   - build_hours + final_hours = planned_dev_hours.
 *   - One developer, base 35 dev hrs/week → 7 hrs/weekday. Weekends 0.
 *     Per-week base override (e.g. dev out one day → 28h → 5.6 hrs/day).
 *     Blackout zeros the whole week. Help hours stack on top of base
 *     unless designer_out is set.
 *   - Sites are scanned in priority order. Each weekday, fill capacity
 *     by picking the highest-priority WORKABLE segment (a build with
 *     hours left, OR a final whose review has elapsed). When the
 *     top-priority site enters review, the dev pivots to the next
 *     site's build. When review elapses, the top-priority site's final
 *     preempts whatever else is being built.
 *   - In-flight sites consume tracked time against build first, then
 *     final, so a nearly-done site skips straight to the final
 *     segment.
 *   - waiting_feedback sites enter the simulation in 'finalizing' state
 *     with final_hours remaining — partner review is already complete
 *     from their POV; we're just waiting on dev to ship the final
 *     pass. launched sites are excluded entirely.
 *
 * All date math uses UTC.
 */

/** ISO yyyy-mm-dd → UTC midnight Date. */
export function parseD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** UTC midnight Date → ISO yyyy-mm-dd. */
export function fmtISO(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

const DAY_MS = 86_400_000

/** Add calendar days. */
export function addCal(dt: Date, n: number): Date {
  return new Date(dt.getTime() + n * DAY_MS)
}

/** Snap to the Monday of the given date's week (UTC). */
export function mondayOf(dt: Date): Date {
  const wd = dt.getUTCDay()
  const off = wd === 0 ? -6 : 1 - wd
  return new Date(dt.getTime() + off * DAY_MS)
}

/** Add business days (skip Sat/Sun). */
export function addBiz(dt: Date, n: number): Date {
  let d = new Date(dt.getTime())
  let left = Math.round(n)
  while (left > 0) {
    d = addCal(d, 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d
}

/** Calendar-days between (b - a). */
export function calBtw(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

// ── Domain types ────────────────────────────────────────────────────

/** A site row the scheduler walks in priority order. */
export interface SchedulerSite {
  id:             string
  priority:       number
  status:         'in_progress' | 'waiting_feedback' | 'launched'
  planned_dev_hours: number
  tracked_hours:  number
  /** 0..1 progress fraction. Optional; used by paceOf when present. */
  pct_complete:   number | null
  target_launch:  string | null         // ISO yyyy-mm-dd
  hard_deadline:  string | null         // ISO yyyy-mm-dd; immovable date
  recovery_mode:  'designer' | 'dev-only'
}

/** Per-week org-wide adjustment row from strategy_dev_weekly_allocations. */
export interface WeekAdjustment {
  week_starting: string                 // ISO Monday
  help_hours:    number
  designer_out:  boolean
  is_blackout:   boolean
  /** When set, overrides the developer's locked 35h base for this
   *  week. help_hours still stack on top; is_blackout still zeros
   *  the whole week. Null = use cfg.base_weekly_cap. */
  base_capacity?: number | null
}

/** Scheduler config (the locked constants + the calendar anchor). */
export interface SchedulerConfig {
  schedule_start:   string              // ISO yyyy-mm-dd
  base_weekly_cap:  number              // hard 35
  sprint_weeks:     number              // 2
  launch_tail_days: number              // 0 by default
  max_help_per_week: number             // 35 — one full extra person per week max
  /** Calendar days each site is out for partner review between build
   *  and final edits. Dev pivots to other sites during this window. */
  review_days:      number              // default 4
  /** Hours reserved for the final edits + launch pass that runs after
   *  partner review. Subtracted from planned_dev_hours to derive
   *  build hours. */
  final_hours:      number              // default 7
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  schedule_start:    todayISO(),
  base_weekly_cap:   35,
  sprint_weeks:      2,
  launch_tail_days:  0,
  max_help_per_week: 35,
  review_days:       4,
  final_hours:       7,
}

function todayISO(): string {
  // UTC midnight today.
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10)
}

/** Per-site result returned by computeSchedule.
 *
 *  `alloc` = combined dev hours per week (build + final). Used by the
 *  capacity bar and the recovery solver. `buildAllocByWeek` and
 *  `finalAllocByWeek` are the per-phase break-down for sprint cards.
 *  `firstBuildDayByWeek` / `firstFinalDayByWeek` give the first weekday
 *  the dev touched each phase in each week — used to order the phase
 *  rows inside a sprint card by when they actually happened.
 *  reviewStart/reviewEnd is a half-open interval: the partner is out
 *  from reviewStart through reviewEnd-1, and on reviewEnd the site is
 *  back in dev's hands.
 */
export interface SiteSchedule {
  startWeek:           number              // first week containing dev activity
  endWeek:             number              // week containing finalEnd (or buildEnd if no final)
  alloc:               Record<number, number>  // weekIndex → total dev hrs (build + final)
  buildAllocByWeek:    Record<number, number>
  finalAllocByWeek:    Record<number, number>
  firstBuildDayByWeek: Record<number, Date>
  firstFinalDayByWeek: Record<number, Date>
  buildStart:          Date | null
  buildEnd:            Date | null
  reviewStart:         Date | null
  reviewEnd:           Date | null
  finalStart:          Date | null
  finalEnd:            Date | null
  devStartDate:        Date
  devCompleteDate:     Date
  launchDate:          Date
  /** delta_days = target_launch − launchDate (calendar days).
   *  positive = ahead of target ; negative = behind. */
  delta:               number | null
}

/** Adjustment lookup helpers. */
export type HelpMap  = Record<number, number>   // weekIndex → extra help hrs (designer)
export type WeekFlag = Record<number, boolean>  // weekIndex → designer_out / is_blackout
export type BaseCapMap = Record<number, number> // weekIndex → base capacity override (sub-35 when dev is out part of the week)

export function buildHelpMap(adjustments: WeekAdjustment[], cfg: SchedulerConfig): HelpMap {
  const start = mondayOf(parseD(cfg.schedule_start))
  const out: HelpMap = {}
  for (const a of adjustments) {
    const idx = weeksBetween(start, parseD(a.week_starting))
    if (idx >= 0 && a.help_hours > 0) out[idx] = a.help_hours
  }
  return out
}

export function buildDesignerOutMap(adjustments: WeekAdjustment[], cfg: SchedulerConfig): WeekFlag {
  const start = mondayOf(parseD(cfg.schedule_start))
  const out: WeekFlag = {}
  for (const a of adjustments) {
    const idx = weeksBetween(start, parseD(a.week_starting))
    if (idx >= 0 && a.designer_out) out[idx] = true
  }
  return out
}

export function buildBlackoutMap(adjustments: WeekAdjustment[], cfg: SchedulerConfig): WeekFlag {
  const start = mondayOf(parseD(cfg.schedule_start))
  const out: WeekFlag = {}
  for (const a of adjustments) {
    const idx = weeksBetween(start, parseD(a.week_starting))
    if (idx >= 0 && a.is_blackout) out[idx] = true
  }
  return out
}

export function buildBaseCapMap(adjustments: WeekAdjustment[], cfg: SchedulerConfig): BaseCapMap {
  const start = mondayOf(parseD(cfg.schedule_start))
  const out: BaseCapMap = {}
  for (const a of adjustments) {
    const idx = weeksBetween(start, parseD(a.week_starting))
    if (idx >= 0 && a.base_capacity != null && a.base_capacity >= 0) {
      out[idx] = Number(a.base_capacity)
    }
  }
  return out
}

function weeksBetween(weekStartAnchor: Date, week: Date): number {
  return Math.round((mondayOf(week).getTime() - weekStartAnchor.getTime()) / (7 * DAY_MS))
}

// ── Capacity ────────────────────────────────────────────────────────

/** Monday of week index `i` (0 = anchor week). */
export function weekStart(i: number, cfg: SchedulerConfig): Date {
  return addCal(mondayOf(parseD(cfg.schedule_start)), i * 7)
}

/** Effective weekly capacity for week `i` given the adjustments.
 *  - Blackout zeros everything.
 *  - base_capacity_override (when set on the adjustment row) replaces
 *    the team default 35h base; otherwise cfg.base_weekly_cap.
 *  - help_hours stack on top of the base, unless designer_out is set
 *    (then no help that week — no one to offload to). */
export function effCap(
  i: number,
  helpMap: HelpMap,
  designerOut: WeekFlag,
  blackout: WeekFlag,
  cfg: SchedulerConfig,
  baseCap?: BaseCapMap,
): number {
  if (blackout[i]) return 0
  const base = baseCap?.[i] != null ? baseCap[i] : cfg.base_weekly_cap
  const help = designerOut[i] ? 0 : (helpMap[i] ?? 0)
  return Math.max(0, base + help)
}

/** Hours remaining for a site — full estimate for in-progress sites
 *  with no tracked time, estimate − tracked otherwise. */
export function remainingHours(site: SchedulerSite): number {
  if (site.status === 'launched') return 0
  return Math.max(0, Number(site.planned_dev_hours || 0) - Number(site.tracked_hours || 0))
}

// ── Day-level simulation ────────────────────────────────────────────

const MAX_WEEKS = 800     // ~15 years; guard against runaway loops
const MAX_DAYS  = MAX_WEEKS * 7

/** Walk active sites in priority order at the day level, applying the
 *  build → review → final phase model. PURE — takes a helpMap, mutates
 *  nothing.
 *
 *  Sites included in active scheduling:
 *    - in_progress       → standard build → review → final flow.
 *      Tracked time fills build first, then final.
 *    - waiting_feedback  → enter directly in 'finalizing' state with
 *      `final_hours` remaining. Partner review is treated as already
 *      complete; the site ships as soon as dev reaches it.
 *  Sites excluded:
 *    - launched          → done, no schedule. */
export function computeSchedule(
  sites:        SchedulerSite[],
  helpMap:      HelpMap,
  designerOut:  WeekFlag,
  blackout:     WeekFlag,
  cfg:          SchedulerConfig = DEFAULT_CONFIG,
  baseCap?:     BaseCapMap,
): Record<string, SiteSchedule> {
  type SiteState = {
    site:                SchedulerSite
    state:               'building' | 'review' | 'finalizing' | 'done'
    buildLeft:           number
    finalLeft:           number
    buildStart:          Date | null
    buildEnd:            Date | null
    reviewStart:         Date | null
    reviewEnd:           Date | null
    finalStart:          Date | null
    finalEnd:            Date | null
    launchDate:          Date | null
    buildAllocByWeek:    Record<number, number>
    finalAllocByWeek:    Record<number, number>
    firstBuildDayByWeek: Record<number, Date>
    firstFinalDayByWeek: Record<number, Date>
  }

  const finalHcap = Math.max(0, cfg.final_hours ?? 0)
  const reviewDays = Math.max(0, Math.floor(cfg.review_days ?? 0))

  const active = [...sites]
    .filter(s => s.status !== 'launched')
    .sort((a, b) => a.priority - b.priority)

  const states = new Map<string, SiteState>()
  for (const s of active) {
    const planned = Math.max(0, Number(s.planned_dev_hours || 0))
    const tracked = Math.max(0, Number(s.tracked_hours || 0))
    const finalH = Math.min(finalHcap, planned)
    const buildH = Math.max(0, planned - finalH)

    let buildLeft: number
    let finalLeft: number
    let state: SiteState['state']

    if (s.status === 'waiting_feedback') {
      buildLeft = 0
      finalLeft = finalH
      state = finalLeft > 0 ? 'finalizing' : 'done'
    } else {
      buildLeft = Math.max(0, buildH - tracked)
      const overflow = Math.max(0, tracked - buildH)
      finalLeft = Math.max(0, finalH - overflow)
      if (buildLeft <= 0 && finalLeft <= 0)      state = 'done'
      else if (buildLeft <= 0 && finalLeft > 0)  state = 'finalizing'
      else                                       state = 'building'
    }

    states.set(s.id, {
      site: s,
      state, buildLeft, finalLeft,
      buildStart: null, buildEnd: null,
      reviewStart: null, reviewEnd: null,
      finalStart: null, finalEnd: null,
      launchDate: null,
      buildAllocByWeek:    {},
      finalAllocByWeek:    {},
      firstBuildDayByWeek: {},
      firstFinalDayByWeek: {},
    })
  }

  const anchor = mondayOf(parseD(cfg.schedule_start))
  const EPS = 0.001
  let allDone = active.every(s => states.get(s.id)!.state === 'done')

  for (let dayOffset = 0; !allDone && dayOffset < MAX_DAYS; dayOffset++) {
    const d = addCal(anchor, dayOffset)
    const wd = d.getUTCDay()
    const weekIdx = Math.floor(dayOffset / 7)

    // Promote reviews whose period has elapsed (start-of-day check).
    for (const s of active) {
      const st = states.get(s.id)!
      if (st.state === 'review' && st.reviewEnd && d.getTime() >= st.reviewEnd.getTime()) {
        st.state = 'finalizing'
      }
    }

    // Weekends = no dev work, but reviews still tick.
    if (wd === 0 || wd === 6) continue

    const weekCap = effCap(weekIdx, helpMap, designerOut, blackout, cfg, baseCap)
    let dayCap = weekCap / 5
    if (dayCap <= 0) continue

    // Allocate in priority order; preempt when a higher-priority
    // segment becomes workable.
    while (dayCap > EPS) {
      let picked: SiteState | null = null
      for (const s of active) {
        const st = states.get(s.id)!
        if ((st.state === 'building'   && st.buildLeft > 0) ||
            (st.state === 'finalizing' && st.finalLeft > 0)) {
          picked = st
          break
        }
      }
      if (!picked) break

      if (picked.state === 'building') {
        const work = Math.min(dayCap, picked.buildLeft)
        dayCap -= work
        picked.buildLeft -= work
        picked.buildAllocByWeek[weekIdx] = (picked.buildAllocByWeek[weekIdx] ?? 0) + work
        if (!picked.firstBuildDayByWeek[weekIdx]) picked.firstBuildDayByWeek[weekIdx] = d
        if (!picked.buildStart) picked.buildStart = d
        if (picked.buildLeft <= EPS) {
          picked.buildLeft = 0
          picked.buildEnd = d
          if (picked.finalLeft > 0 && reviewDays > 0) {
            picked.state = 'review'
            picked.reviewStart = d
            picked.reviewEnd = addCal(d, reviewDays)
          } else if (picked.finalLeft > 0) {
            picked.state = 'finalizing'
          } else {
            picked.state = 'done'
            picked.finalEnd = d
            picked.launchDate = addCal(d, cfg.launch_tail_days)
          }
        }
      } else {
        const work = Math.min(dayCap, picked.finalLeft)
        dayCap -= work
        picked.finalLeft -= work
        picked.finalAllocByWeek[weekIdx] = (picked.finalAllocByWeek[weekIdx] ?? 0) + work
        if (!picked.firstFinalDayByWeek[weekIdx]) picked.firstFinalDayByWeek[weekIdx] = d
        if (!picked.finalStart) picked.finalStart = d
        if (picked.finalLeft <= EPS) {
          picked.finalLeft = 0
          picked.finalEnd = d
          picked.launchDate = addCal(d, cfg.launch_tail_days)
          picked.state = 'done'
        }
      }
    }

    allDone = active.every(s => states.get(s.id)!.state === 'done')
  }

  // Materialize SiteSchedule for each active site.
  const res: Record<string, SiteSchedule> = {}
  const weekIdxFromDate = (dt: Date): number =>
    Math.floor(calBtw(anchor, dt) / 7)

  for (const s of active) {
    const st = states.get(s.id)!

    const alloc: Record<number, number> = {}
    for (const [k, v] of Object.entries(st.buildAllocByWeek)) {
      const wi = Number(k)
      alloc[wi] = (alloc[wi] ?? 0) + v
    }
    for (const [k, v] of Object.entries(st.finalAllocByWeek)) {
      const wi = Number(k)
      alloc[wi] = (alloc[wi] ?? 0) + v
    }

    const devStart = st.buildStart ?? st.finalStart
    const devEnd   = st.finalEnd ?? st.buildEnd

    // Defensive fallback: a site with no segments left (planned=0,
    // tracked=0, or both segments already drained) lands on the
    // anchor. Recovery solver checks delta against this stable date.
    const fallback = mondayOf(parseD(cfg.schedule_start))
    const finalDevStart = devStart ?? fallback
    const finalDevEnd   = devEnd   ?? finalDevStart
    const finalLaunch   = st.launchDate ?? addCal(finalDevEnd, cfg.launch_tail_days)

    res[s.id] = {
      startWeek:           weekIdxFromDate(finalDevStart),
      endWeek:             weekIdxFromDate(finalLaunch),
      alloc,
      buildAllocByWeek:    st.buildAllocByWeek,
      finalAllocByWeek:    st.finalAllocByWeek,
      firstBuildDayByWeek: st.firstBuildDayByWeek,
      firstFinalDayByWeek: st.firstFinalDayByWeek,
      buildStart:          st.buildStart,
      buildEnd:            st.buildEnd,
      reviewStart:         st.reviewStart,
      reviewEnd:           st.reviewEnd,
      finalStart:          st.finalStart,
      finalEnd:            st.finalEnd,
      devStartDate:        finalDevStart,
      devCompleteDate:     finalDevEnd,
      launchDate:          finalLaunch,
      delta: s.target_launch
        ? calBtw(finalLaunch, parseD(s.target_launch))
        : null,
    }
  }
  return res
}

// ── Pace ────────────────────────────────────────────────────────────

export type PaceClass = 'good' | 'tight' | 'late'

export interface PaceResult {
  pct:       number       // 0..100
  projected: number       // total hours projected at current burn rate
  over:      number       // projected − planned (positive = burning over)
  cls:       PaceClass
}

/** Pace projection for an in-flight site. Returns null when not
 *  in_progress or no tracked time has been logged yet. */
export function paceOf(site: SchedulerSite): PaceResult | null {
  if (site.status !== 'in_progress' || !site.tracked_hours) return null
  const pct = site.pct_complete ?? 0
  if (pct <= 0) {
    return {
      pct:       0,
      projected: site.planned_dev_hours,
      over:      0,
      cls:       'good',
    }
  }
  const projected = Math.round(site.tracked_hours / pct)
  const over = projected - site.planned_dev_hours
  const cls: PaceClass = over > 3 ? 'late' : over < -1 ? 'good' : 'tight'
  return { pct: Math.round(pct * 100), projected, over, cls }
}

// ── Status mapping (current_phase → SchedulerSite.status) ───────────

/** Per the user's call:
 *  - intake / content / design / dev → 'in_progress' (consume hours)
 *  - review                          → 'waiting_feedback' (final pass remains)
 *  - launched                        → 'launched' (excluded) */
export function statusFromPhase(phase: string | null | undefined): SchedulerSite['status'] {
  if (phase === 'launched') return 'launched'
  if (phase === 'review')   return 'waiting_feedback'
  return 'in_progress'
}
