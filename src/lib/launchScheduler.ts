/**
 * Launch scheduler — pure engine ported from the prototype at
 * prototypes/launch-planner/launch-planner-prototype.html.
 *
 * Mental model (don't deviate):
 *   - One developer, HARD 35 dev hrs/week. Never raised.
 *   - Sites run sequentially in priority order. Sprint-splitting falls
 *     out naturally (when a site needs less than the sprint, the next
 *     site picks up the rest).
 *   - "Extra help hours" are a separate org-wide per-week resource
 *     (typically the designer). They stack ON TOP of the locked 35.
 *     Only applied when designer_out = false for that week.
 *   - Help has TWO gating conditions to actually pull a launch earlier:
 *     (a) site is `designer`-recoverable, not `dev-only`, AND
 *     (b) designer is available the eligible weeks.
 *     If either fails, the projected launch stands.
 *   - Schedule only the work that's LEFT. In-progress sites consume
 *     `dev_hours_estimate − tracked_hours`. Launched + waiting-feedback
 *     are excluded from active scheduling.
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
}

/** Scheduler config (the locked constants + the calendar anchor). */
export interface SchedulerConfig {
  schedule_start:  string               // ISO yyyy-mm-dd
  base_weekly_cap: number               // hard 35
  sprint_weeks:    number               // 2
  launch_tail_days: number              // 0 by default
  max_help_per_week: number             // 35 — one full extra person per week max
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  schedule_start:    todayISO(),
  base_weekly_cap:   35,
  sprint_weeks:      2,
  launch_tail_days:  0,
  max_help_per_week: 35,
}

function todayISO(): string {
  // UTC midnight today.
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10)
}

/** Per-site result returned by computeSchedule. */
export interface SiteSchedule {
  startWeek:        number              // index into the week stream from schedule_start
  endWeek:          number
  alloc:            Record<number, number>  // weekIndex → hours consumed by this site
  devCompleteDate:  Date
  launchDate:       Date                // dev complete + launch_tail_days
  /** delta_days = launchDate − target_launch (calendar days).
   *  positive = ahead of target ; negative = behind. */
  delta:            number | null
}

/** Adjustment lookup helpers. */
export type HelpMap = Record<number, number>   // weekIndex → extra help hrs (designer)
export type WeekFlag = Record<number, boolean> // weekIndex → designer_out / is_blackout

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

function weeksBetween(weekStartAnchor: Date, week: Date): number {
  return Math.round((mondayOf(week).getTime() - weekStartAnchor.getTime()) / (7 * DAY_MS))
}

// ── Capacity ────────────────────────────────────────────────────────

/** Monday of week index `i` (0 = anchor week). */
export function weekStart(i: number, cfg: SchedulerConfig): Date {
  return addCal(mondayOf(parseD(cfg.schedule_start)), i * 7)
}

/** Effective capacity for week `i` given the adjustments. */
export function effCap(
  i: number,
  helpMap: HelpMap,
  designerOut: WeekFlag,
  blackout: WeekFlag,
  cfg: SchedulerConfig,
): number {
  if (blackout[i]) return 0
  const help = designerOut[i] ? 0 : (helpMap[i] ?? 0)
  return cfg.base_weekly_cap + help
}

/** Hours remaining for a site — full estimate for in-progress sites
 *  with no tracked time, estimate − tracked otherwise. */
export function remainingHours(site: SchedulerSite): number {
  if (site.status !== 'in_progress') return 0
  return Math.max(0, Number(site.planned_dev_hours || 0) - Number(site.tracked_hours || 0))
}

// ── Pure scheduler ──────────────────────────────────────────────────

const MAX_WEEKS = 800     // ~15 years; guard against runaway loops

/** Walk active sites in priority order; consume the weekly capacity
 *  pool sequentially. PURE — takes a helpMap, mutates nothing.
 *
 *  Sites excluded from active scheduling:
 *    - `launched`         → done
 *    - `waiting_feedback` → dev mostly complete; project sits in
 *      partner review. No hours are consumed.
 *  Both kinds still appear in the queue UI but get no `alloc` /
 *  `launchDate` here. */
export function computeSchedule(
  sites:        SchedulerSite[],
  helpMap:      HelpMap,
  designerOut:  WeekFlag,
  blackout:     WeekFlag,
  cfg:          SchedulerConfig = DEFAULT_CONFIG,
): Record<string, SiteSchedule> {
  const active = [...sites]
    .filter(s => s.status === 'in_progress')
    .sort((a, b) => a.priority - b.priority)

  const res: Record<string, SiteSchedule> = {}
  let wi = 0
  let rem = effCap(0, helpMap, designerOut, blackout, cfg)

  for (const s of active) {
    let need = remainingHours(s)
    const alloc: Record<number, number> = {}

    if (need <= 0) {
      const ws = weekStart(wi, cfg)
      res[s.id] = {
        startWeek:       wi,
        endWeek:         wi,
        alloc,
        devCompleteDate: ws,
        launchDate:      addCal(ws, cfg.launch_tail_days),
        delta:           s.target_launch
          ? calBtw(addCal(ws, cfg.launch_tail_days), parseD(s.target_launch))
          : null,
      }
      continue
    }

    // Walk past zero-capacity weeks (blackout) at the front.
    while (rem <= 0 && wi < MAX_WEEKS) {
      wi++
      rem = effCap(wi, helpMap, designerOut, blackout, cfg)
    }
    const sw = wi

    while (need > 0 && wi < MAX_WEEKS) {
      if (rem <= 0) {
        wi++
        rem = effCap(wi, helpMap, designerOut, blackout, cfg)
        continue
      }
      const use = Math.min(need, rem)
      alloc[wi] = (alloc[wi] ?? 0) + use
      need -= use
      rem -= use
      if (need <= 0) break
    }

    const ew = wi
    const cap = effCap(wi, helpMap, designerOut, blackout, cfg) || cfg.base_weekly_cap
    const consumed = cap - rem
    const into = Math.max(0, Math.ceil((consumed / cap) * 5))
    const devCompleteDate = addBiz(weekStart(ew, cfg), into)
    const launchDate = addCal(devCompleteDate, cfg.launch_tail_days)

    res[s.id] = {
      startWeek: sw,
      endWeek:   ew,
      alloc,
      devCompleteDate,
      launchDate,
      delta:     s.target_launch
        ? calBtw(launchDate, parseD(s.target_launch))
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
 *  - review                          → 'waiting_feedback' (excluded)
 *  - launched                        → 'launched' (excluded) */
export function statusFromPhase(phase: string | null | undefined): SchedulerSite['status'] {
  if (phase === 'launched') return 'launched'
  if (phase === 'review')   return 'waiting_feedback'
  return 'in_progress'
}
