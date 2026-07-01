/**
 * CSV export for the Website Launch Planner build queue.
 *
 * Dumps every column visible in QueueTable — partner name, member
 * number, activity sub-label, phase, status, projected vs target
 * launch, delta, design-due, dev start, sprint span, dev hours, help
 * hours — for every project across the queue's four buckets (active,
 * paused, blocked, launched). One row per project; unavailable fields
 * render empty (not "null"/"undefined") so the CSV opens cleanly in
 * Excel and Sheets.
 */

import type { ProjectLaunchRow } from '../hooks/useLaunchPlan'
import type { SchedulerSite, SiteSchedule } from './launchScheduler'

const COLUMNS = [
  'priority',
  'partner',
  'member',
  'activity',
  'phase',
  'status',
  'projected_launch',
  'target_launch',
  'hard_deadline',
  'delta_days',
  'design_due',
  'dev_start',
  'sprint_span',
  'dev_hours',
  'help_hours',
  'project_id',
] as const

type Column = typeof COLUMNS[number]

export interface QueueCsvArgs {
  rows:     ProjectLaunchRow[]
  sites:    SchedulerSite[]
  schedule: Record<string, SiteSchedule>
}

/** Build a CSV string of every project row visible on /web. Ordering:
 *  active queue (by priority_order) → paused → blocked → launched.
 *  Priority column only fills for active rows since only they consume
 *  queue capacity. */
export function buildQueueCsv({ rows, sites, schedule }: QueueCsvArgs): string {
  const siteById = new Map(sites.map(s => [s.id, s]))
  const activeRows: ProjectLaunchRow[] = []
  const pausedRows:   ProjectLaunchRow[] = []
  const blockedRows:  ProjectLaunchRow[] = []
  const launchedRows: ProjectLaunchRow[] = []
  for (const r of rows) {
    if (r.archived) continue
    const site = siteById.get(r.id)
    const launched = r.effective_phase === 'launched'
    const paused   = site?.status === 'paused'
    const blocked  = site?.status === 'blocked'
    if (launched)      launchedRows.push(r)
    else if (paused)   pausedRows.push(r)
    else if (blocked)  blockedRows.push(r)
    else               activeRows.push(r)
  }
  activeRows.sort((a, b) => (a.priority_order ?? 99_999) - (b.priority_order ?? 99_999))

  const lines: string[] = []
  lines.push(COLUMNS.join(','))

  const push = (row: ProjectLaunchRow, priority: number | null, statusOverride?: string) => {
    const site = siteById.get(row.id)
    const slot = schedule[row.id]
    const isWaiting = site?.status === 'waiting_feedback'
    const status = statusOverride ?? (isWaiting ? 'waiting_feedback' : 'active')

    const projected = slot?.launchDate ? toIso(slot.launchDate) : ''
    const devStartIso = slot?.devStartDate ? toIso(slot.devStartDate) : ''
    const designDue = devStartIso ? subBizDaysIso(devStartIso, 2) : ''
    const sprintSpan = slot ? `w${slot.startWeek}–w${slot.endWeek}` : ''

    const cells: Record<Column, string | number | null | undefined> = {
      priority,
      partner:          row.church_name ?? '',
      member:           row.member ?? '',
      activity:         row.activity_label ?? '',
      phase:            row.effective_phase ?? row.current_phase ?? '',
      status,
      projected_launch: projected,
      target_launch:    row.launch_date ?? '',
      hard_deadline:    row.hard_deadline ? 'yes' : 'no',
      delta_days:       slot?.delta ?? '',
      design_due:       designDue,
      dev_start:        devStartIso,
      sprint_span:      sprintSpan,
      dev_hours:        row.planned_dev_hours ?? '',
      help_hours:       row.help_hours_needed ?? '',
      project_id:       row.id,
    }
    lines.push(COLUMNS.map(c => csvCell(cells[c])).join(','))
  }

  activeRows.forEach((r, i) => push(r, i + 1))
  pausedRows.forEach(r => push(r, null, 'paused'))
  blockedRows.forEach(r => push(r, null, 'blocked'))
  launchedRows.forEach(r => push(r, null, 'launched'))

  return lines.join('\n')
}

/** Trigger a CSV download in the browser. Filename is derived from the
 *  current date so subsequent exports don't clobber. Safe on non-browser
 *  environments (SSR / tests) — becomes a no-op. */
export function downloadQueueCsv(args: QueueCsvArgs, filename?: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const csv = buildQueueCsv(args)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename ?? `build-queue-${todayIso()}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Escape a value for CSV: wrap in quotes if the value contains a
 *  comma / newline / quote, and double any embedded quotes. Numbers
 *  and empty values pass through. */
function csvCell(v: string | number | null | undefined): string {
  if (v == null || v === '') return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function todayIso(): string {
  // Deliberately avoids `new Date()` for browser-locale friendliness —
  // UTC anchor gives consistent filenames regardless of timezone.
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))
    .toISOString().slice(0, 10)
}

/** Mirror of QueueTable.subBizDays — kept here so the CSV builder is
 *  self-contained. Subtracts N business days (Mon–Fri) from an ISO date. */
function subBizDaysIso(iso: string, n: number): string {
  let d = new Date(`${iso}T00:00:00Z`)
  let left = Math.max(0, Math.round(n))
  while (left > 0) {
    d = new Date(d.getTime() - 86_400_000)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d.toISOString().slice(0, 10)
}
