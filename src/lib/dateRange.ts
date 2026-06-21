/**
 * Date helpers for the Website Manager scheduler.
 *
 * Keep these pure and dependency-free — they're used by the Board
 * view (relative-time labels), Schedule view (week column generation),
 * and the health math (weeks-to-launch, calendar gap).
 *
 * Convention: weeks start on **Monday**, matching the actual
 * strategy_dev_weekly_allocations.week_starting values the allocation
 * grid persists. (An earlier comment claimed Sunday alignment; that
 * was inconsistent with the data.) `weekStart(d)` is idempotent.
 */

/** Local-time Monday on or before `d`, with H/M/S/ms zeroed.
 *  Matches the Monday-aligned `week_starting` keys saved by the
 *  allocation grid in PlanningWorkspace. */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // getDay() returns 0=Sun, 1=Mon...6=Sat. Snap back to Monday:
  //   Sun (0) → 6 days back to previous Monday
  //   Mon (1) → 0 days (already Mon)
  //   Tue+    → (dow - 1) days back
  const dow = out.getDay()
  const offset = dow === 0 ? -6 : 1 - dow
  out.setDate(out.getDate() + offset)
  return out
}

/** Add `n` weeks to `d`. Negative n moves backward. */
export function addWeeks(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n * 7)
  return out
}

/** Whole weeks between two dates (Sunday-aligned). Positive when `b`
 *  is after `a`. */
export function weeksBetween(a: Date, b: Date): number {
  const ms = weekStart(b).getTime() - weekStart(a).getTime()
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000))
}

/** Inclusive-start list of weekStarts from `from` to `to`. */
export function weekRange(from: Date, to: Date): Date[] {
  const out: Date[] = []
  let cur = weekStart(from)
  const end = weekStart(to)
  while (cur.getTime() <= end.getTime()) {
    out.push(cur)
    cur = addWeeks(cur, 1)
  }
  return out
}

/** ISO yyyy-mm-dd for a Date (local-time, no UTC drift). */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse "yyyy-mm-dd" / "yyyy-mm-ddTHH:..." into a local-noon Date.
 *  Returns null on bad input. Local noon avoids day-shift from UTC
 *  parsing on dates near midnight. */
export function fromIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole days from `a` to `b` (ignores time of day). */
export function daysBetween(a: Date, b: Date): number {
  const ad = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const bd = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((bd - ad) / (24 * 60 * 60 * 1000))
}

/** Human-friendly relative-time label vs. `today`.
 *
 *  Examples (today = Jun 1):
 *    fmt('2026-05-30') → '2d ago'
 *    fmt('2026-06-01') → 'today'
 *    fmt('2026-06-08') → 'in 7d'
 *    fmt('2026-09-01') → 'in 13w'
 *
 *  Past >90d collapses to "<month> <day>"; future >180d does the same.
 *  Tunable thresholds if the team wants finer granularity. */
export function formatRelative(target: Date | string | null, today: Date = new Date()): string {
  const d = typeof target === 'string' ? fromIsoDate(target) : target
  if (!d) return ''
  const days = daysBetween(today, d)
  if (days === 0) return 'today'
  const abs = Math.abs(days)
  if (abs === 1) return days > 0 ? 'in 1d' : 'yesterday'
  if (abs < 14) return days > 0 ? `in ${abs}d` : `${abs}d ago`
  if (abs < 90) {
    const w = Math.round(abs / 7)
    return days > 0 ? `in ${w}w` : `${w}w ago`
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Format a date as "MMM d" (e.g. "Jun 8") for schedule column headers. */
export function formatMonthDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
