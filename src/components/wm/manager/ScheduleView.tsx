/**
 * Gantt-lite capacity grid for the Web Manager.
 *
 * Layout: CSS grid with a frozen left column (project list) and a
 * scrolling right region (week columns). Each cell shows the hours
 * the project is allocated for that week, color-tinted by current
 * phase. The capacity bar at the top of each week column shows total
 * allocated across all projects vs Josh's 30h weekly capacity.
 *
 * Sources:
 *   • rows  — ProjectRowVM[] from useProjectsWithHealth (already
 *             carries each project's allocations list)
 *   • horizon — Next 8w / 16w / 26w, segmented toggle
 *
 * Click a cell → opens the project's edit panel (URL ?edit=).
 *
 * Drag-to-move and explicit "Edit allocation" modal are deferred —
 * for v1, week edits go through the panel. The grid is read-mostly.
 */
import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { WMSegmentedToggle } from '../SegmentedToggle'
import {
  addWeeks, formatMonthDay, fromIsoDate, toIsoDate, weekStart,
} from '../../../lib/dateRange'
import { DEFAULT_DEV_CAPACITY } from '../../../lib/webProjectHealth'
import type { ProjectRowVM, DevTaskRow } from '../../../hooks/useProjectsWithHealth'
import type { WebProjectPhase } from '../../../types/database'

// Team ID is constant per the org's ClickUp workspace; task URLs are
// `/t/<team>/<task_id>`. Defined here (vs imported from ClickUpTasksSummary)
// to keep the schedule view a leaf component.
const CLICKUP_TEAM_ID = 1235435

interface Props {
  rows:     ProjectRowVM[]
  loading:  boolean
  onSelect: (projectId: string) => void
  capacityPerWeek?: number
  /** Persist a project's dev_hours_estimate edit. Returns once the
   *  write lands so the parent can refetch. */
  onUpdateDevHours?: (projectId: string, hours: number | null) => void | Promise<void>
}

type Horizon = '8' | '16' | '26'

const PHASE_TINT: Record<WebProjectPhase, string> = {
  intake:   'bg-wm-bg-hover         text-wm-text',
  content:  'bg-wm-info-bg          text-wm-info',
  design:   'bg-wm-tone-pink-bg     text-wm-tone-pink',
  dev:      'bg-wm-tone-blue-bg     text-wm-tone-blue',
  review:   'bg-wm-tone-yellow-bg   text-wm-tone-yellow',
  launched: 'bg-wm-success-bg       text-wm-success',
}

export function ScheduleView({
  rows, loading, onSelect, capacityPerWeek = DEFAULT_DEV_CAPACITY,
  onUpdateDevHours,
}: Props) {
  const [horizon, setHorizon] = useState<Horizon>('16')

  const weeks = useMemo(() => {
    const start = weekStart(new Date())
    const count = Number(horizon)
    return Array.from({ length: count }, (_, i) => addWeeks(start, i))
  }, [horizon])
  const weekIso = useMemo(() => weeks.map(toIsoDate), [weeks])
  const todayIso = useMemo(() => toIsoDate(weekStart(new Date())), [])

  // Per-project per-week hours. The queue's weeklyHours is the
  // source of truth — it's computed once with a shared weekly pool
  // so leftover capacity in one project's week rolls into the next.
  // Manual allocations (entered in the Planning grid) override per
  // (project, week).
  const buckets = useMemo(() => {
    const out = new Map<string, Map<string, number>>()
    for (const r of rows) {
      const inner = new Map<string, number>()
      if (r.queueSlot?.weeklyHours) {
        for (const [iso, h] of Object.entries(r.queueSlot.weeklyHours)) {
          inner.set(iso, Number(h))
        }
      }
      for (const a of r.allocations) {
        const iso = a.week_starting.slice(0, 10)
        inner.set(iso, Number(a.hours))
      }
      out.set(r.id, inner)
    }
    return out
  }, [rows])

  // Group dev tasks by week-start ISO for cell-level rendering. Tasks
  // without a due_date_after are skipped here — they're rendered in
  // the queue-projected blocks instead.
  const tasksByProjectWeek = useMemo(() => {
    const out = new Map<string, Map<string, DevTaskRow[]>>()
    for (const r of rows) {
      const inner = new Map<string, DevTaskRow[]>()
      for (const t of r.devTasks) {
        if (!t.due_date_after) continue
        const d = fromIsoDate(t.due_date_after)
        if (!d) continue
        const wIso = toIsoDate(weekStart(d))
        if (!inner.has(wIso)) inner.set(wIso, [])
        inner.get(wIso)!.push(t)
      }
      out.set(r.id, inner)
    }
    return out
  }, [rows])

  // Per-week capacity utilization across the whole queue.
  const weekTotals = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of rows) {
      const inner = buckets.get(r.id)
      if (!inner) continue
      for (const [iso, h] of inner) {
        out[iso] = (out[iso] ?? 0) + h
      }
    }
    return out
  }, [buckets, rows])

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded-md bg-wm-bg-hover animate-pulse" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-wm-border bg-wm-bg p-10 text-center">
        <p className="text-sm text-wm-text-muted">No projects to schedule.</p>
      </div>
    )
  }

  // Which project is the dev actively in (today between queueSlot
  // devStart and devEnd)? Used for the "current sprint" highlight
  // banner above the grid.
  const todayDate = new Date()
  const currentSprint = rows.find(r => {
    if (!r.queueSlot) return false
    const s = fromIsoDate(r.queueSlot.devStartDate)
    const e = fromIsoDate(r.queueSlot.devEndDate)
    return s && e && s <= todayDate && todayDate <= e
  }) ?? null

  // Sticky-left grid: column 1 (project list) is sticky; columns 2..N
  // are week cells. Use `display: grid` with a fixed left-col width
  // and per-week 64px columns for a Gantt feel.
  const gridTemplate = `260px repeat(${weeks.length}, 64px)`

  return (
    <div className="space-y-3">
      {/* Current sprint — which project the dev is actually inside
          this week. Helps the team answer "where is dev right now?"
          without scanning the grid. */}
      {currentSprint?.queueSlot && (() => {
        const slot = currentSprint.queueSlot
        const start = fromIsoDate(slot.devStartDate)
        const end   = fromIsoDate(slot.devEndDate)
        if (!start || !end) return null
        const weeksDur = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (7 * 86400000)))
        // dev_hours_estimate comes back as string from Postgres numeric;
        // coerce explicitly before any arithmetic to avoid NaN crashes.
        const totalH = Number(currentSprint.dev_hours_estimate ?? 0)
        const remaining = Number(slot.remainingDevHours ?? 0)
        const completed = Math.max(0, totalH - remaining)
        const pct = totalH > 0
          ? Math.max(0, Math.min(100, Math.round(100 * completed / totalH)))
          : null
        return (
          <div className="rounded-lg border border-wm-accent/40 bg-wm-accent-tint px-3 py-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
                  Sprint in progress · P{currentSprint.priority_order ?? '?'}
                </p>
                <p className="text-[13px] font-semibold text-wm-text">
                  {currentSprint.church_name
                    ? `${currentSprint.church_name} · #${currentSprint.member}`
                    : `Member #${currentSprint.member}`}
                  {' · '}
                  {currentSprint.name}
                </p>
              </div>
              <div className="text-right text-[11px] text-wm-text-muted">
                <p>
                  Window: {formatMonthDay(start)}
                  {' → '}{formatMonthDay(end)}
                  {' · '}{weeksDur}w
                </p>
                <p className="font-mono tabular-nums text-wm-text">
                  {remaining.toFixed(1)}h left
                  {pct != null ? ` · ${pct}% done` : ''}
                </p>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Horizon toggle + capacity legend */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <WMSegmentedToggle<Horizon>
          active={horizon}
          onChange={setHorizon}
          options={[
            { key: '8',  label: 'Next 8w'  },
            { key: '16', label: 'Next 16w' },
            { key: '26', label: 'Next 26w' },
          ]}
        />
        <p className="text-[11px] text-wm-text-muted">
          <span className="font-semibold text-wm-text">{capacityPerWeek}h/wk</span> capacity
          {' '}· <span className="inline-block w-2 h-2 rounded-sm bg-wm-tone-blue-bg border border-wm-tone-blue/40 align-middle" /> in-progress ClickUp
          {' '}· <span className="inline-block w-2 h-2 rounded-sm bg-wm-success-bg border border-wm-success/30 align-middle" /> complete
          {' '}· faded cell = projected (no ClickUp task yet)
          {' '}· <span className="inline-block w-3 h-2 border-r-2 border-r-wm-success align-middle" /> launch week
        </p>
      </div>

      {/* Scroll container */}
      <div className="relative overflow-x-auto border border-wm-border rounded-lg bg-wm-bg-elevated">
        <div className="inline-grid min-w-full" style={{ gridTemplateColumns: gridTemplate }}>

          {/* ── Header row: capacity utilization per week ── */}
          <div className="sticky left-0 z-20 bg-wm-bg-elevated border-b border-r border-wm-border px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Project</p>
            <p className="text-[10px] text-wm-text-subtle mt-0.5">Capacity / week</p>
          </div>
          {weeks.map((w, i) => {
            const iso = weekIso[i]
            const total = weekTotals[iso] ?? 0
            const over = total > capacityPerWeek
            const isToday = iso === todayIso
            return (
              <div
                key={iso}
                className={[
                  'border-b border-wm-border/60 px-1 py-2 text-center',
                  isToday ? 'border-l-2 border-l-wm-tone-orange' : '',
                ].join(' ')}
              >
                <p className="text-[10px] font-semibold text-wm-text-muted">
                  {formatMonthDay(w)}
                </p>
                <p
                  className={[
                    'mt-1 text-[11px] font-mono tabular-nums',
                    over ? 'text-wm-danger font-bold' : 'text-wm-text-subtle',
                  ].join(' ')}
                  title={`${total.toFixed(1)} of ${capacityPerWeek}h allocated`}
                >
                  {total.toFixed(0)}h
                </p>
              </div>
            )
          })}

          {/* ── Body rows ───────────────────────── */}
          {rows.map(r => (
            <ProjectRow
              key={r.id}
              row={r}
              weeks={weeks}
              weekIso={weekIso}
              todayIso={todayIso}
              cells={buckets.get(r.id) ?? new Map()}
              tasksByWeek={tasksByProjectWeek.get(r.id) ?? new Map()}
              onSelect={onSelect}
              onUpdateDevHours={onUpdateDevHours}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────

interface RowProps {
  row:      ProjectRowVM
  weeks:    Date[]
  weekIso:  string[]
  todayIso: string
  cells:    Map<string, number>
  /** Dev tasks bucketed by week_start ISO. Pre-computed by the
   *  parent so each row doesn't repeat the grouping work. */
  tasksByWeek: Map<string, DevTaskRow[]>
  onSelect: (id: string) => void
  onUpdateDevHours?: (projectId: string, hours: number | null) => void | Promise<void>
}

function ProjectRow({
  row, weeks, weekIso, todayIso, cells, tasksByWeek, onSelect, onUpdateDevHours,
}: RowProps) {
  const phase = (row.current_phase || 'intake') as WebProjectPhase
  const tint = PHASE_TINT[phase] ?? PHASE_TINT.intake
  const churchLine = row.church_name
    ? `${row.church_name} · #${row.member}`
    : `Member #${row.member}`
  const launchIso = row.launch_date
    ? fromIsoDate(row.launch_date)
      ? toIsoDate(weekStart(fromIsoDate(row.launch_date) as Date))
      : null
    : null
  // Sprint window — render as a single contiguous block per project.
  const slot = row.queueSlot
  const startDate = slot?.devStartDate ? fromIsoDate(slot.devStartDate) : null
  const endDate   = slot?.devEndDate   ? fromIsoDate(slot.devEndDate)   : null
  const devStartWeekIso = startDate ? toIsoDate(weekStart(startDate)) : null
  const devEndWeekIso   = endDate   ? toIsoDate(weekStart(endDate))   : null
  const sprintWeeks = startDate && endDate
    ? Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 86400000)))
    : null
  const remainingH = Number(slot?.remainingDevHours ?? 0)
  const totalH = Number(row.dev_hours_estimate ?? 0)
  const completedH = Math.max(0, totalH - remainingH)
  const pct = totalH > 0
    ? Math.max(0, Math.min(100, Math.round(100 * completedH / totalH)))
    : null

  return (
    <>
      {/* Frozen left cell — sprint summary + inline dev-hours edit */}
      <div className="sticky left-0 z-10 bg-wm-bg-elevated border-b border-r border-wm-border px-3 py-2">
        <button
          type="button"
          onClick={() => onSelect(row.id)}
          className="w-full text-left hover:opacity-80 transition-opacity"
        >
          <p className="text-[10px] uppercase tracking-[0.08em] font-bold text-wm-text-subtle truncate">
            {row.priority_order ? `Sprint ${row.priority_order} · ` : ''}{churchLine}
          </p>
          <p className="text-[12px] font-semibold text-wm-text truncate">{row.name}</p>
          {slot && startDate && endDate && (
            <p className="text-[10px] text-wm-accent-strong truncate mt-0.5">
              {formatMonthDay(startDate)} → {formatMonthDay(endDate)}
              {sprintWeeks ? ` · ${sprintWeeks}w` : ''}
            </p>
          )}
        </button>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-wm-text-muted font-mono tabular-nums">
          <span>{remainingH.toFixed(1)}h left of</span>
          {onUpdateDevHours ? (
            <DevHoursInline
              value={totalH}
              onCommit={(v) => onUpdateDevHours(row.id, v)}
            />
          ) : (
            <span>{totalH}h</span>
          )}
          {pct != null && totalH > 0 && <span>· {pct}%</span>}
        </div>
      </div>

      {/* Week cells */}
      {weeks.map((_, i) => {
        const iso = weekIso[i]
        const hours = cells.get(iso) ?? 0
        const isToday  = iso === todayIso
        const isLaunch = iso === launchIso
        const inDevWindow = !!(
          devStartWeekIso && devEndWeekIso
          && iso >= devStartWeekIso && iso <= devEndWeekIso
        )
        const weekTasks = tasksByWeek.get(iso) ?? []
        return (
          <ScheduleCell
            key={iso}
            weekIso={iso}
            phase={phase}
            tint={tint}
            hours={hours}
            isToday={isToday}
            isLaunch={isLaunch}
            inDevWindow={inDevWindow}
            tasks={weekTasks}
            onSelect={() => onSelect(row.id)}
          />
        )
      })}
    </>
  )
}

// ── Cell ─────────────────────────────────────────────────────

interface CellProps {
  weekIso:     string
  phase:       WebProjectPhase
  tint:        string
  hours:       number
  isToday:     boolean
  isLaunch:    boolean
  inDevWindow: boolean
  tasks:       DevTaskRow[]
  onSelect:    () => void
}

function ScheduleCell({
  weekIso, phase, tint, hours, isToday, isLaunch, inDevWindow, tasks, onSelect,
}: CellProps) {
  // Click on the cell background (not on a chip) navigates to the
  // project's planning page. The chips are individually clickable
  // and stopPropagation so they don't bubble to this handler.
  void weekIso  // available for future per-cell features (drag, edit)
  const visible    = tasks.slice(0, 3)
  const extraCount = Math.max(0, tasks.length - visible.length)

  return (
    <div
      onClick={onSelect}
      title={
        tasks.length > 0
          ? `${tasks.length} dev task${tasks.length === 1 ? '' : 's'} this week`
          : hours > 0
            ? `${hours.toFixed(1)}h projected · ${phase}`
            : (inDevWindow ? `Queue window · ${phase}` : 'Outside queue')
      }
      className={[
        'relative border-b border-wm-border/60 h-[52px] px-1 py-1 cursor-pointer transition-colors',
        // Visual cues for today / launch
        isToday  ? 'border-l-2 border-l-wm-tone-orange'  : '',
        isLaunch ? 'border-r-[3px] border-r-wm-success ring-1 ring-inset ring-wm-success/40' : '',
        // Background fill priority: actual tasks > projected hours > queue window > empty
        tasks.length > 0
          ? 'bg-wm-bg-elevated hover:bg-wm-bg-hover'
          : hours > 0
            ? `${tint} font-semibold hover:opacity-90`
            : inDevWindow
              ? `${tint} opacity-40 hover:opacity-60`
              : 'bg-wm-bg hover:bg-wm-bg-hover',
      ].join(' ')}
    >
      {/* Task chips — actual ClickUp work due this week */}
      {tasks.length > 0 ? (
        <div className="flex flex-col gap-[2px]">
          {visible.map(t => (
            <TaskChip key={t.task_id} task={t} />
          ))}
          {extraCount > 0 && (
            <span className="text-[9px] text-wm-text-subtle font-mono leading-none">
              +{extraCount}
            </span>
          )}
        </div>
      ) : (
        hours > 0 && (
          <p className="text-[11px] font-mono tabular-nums text-center">
            {hours.toFixed(0)}h
          </p>
        )
      )}
    </div>
  )
}

// ── Inline editable dev-hours number ─────────────────────────

function DevHoursInline({
  value, onCommit,
}: {
  value: number
  onCommit: (v: number | null) => void | Promise<void>
}) {
  const [v, setV] = useState(String(value || ''))
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setV(String(value || '')); setEditing(true) }}
        title="Click to edit total dev hours"
        className="px-1 -mx-1 rounded hover:bg-wm-accent-tint hover:text-wm-accent-strong"
      >
        {value || 0}h
      </button>
    )
  }
  const commit = () => {
    setEditing(false)
    const num = v.trim() === '' ? null : Number(v)
    const next = Number.isFinite(num as number) ? num : null
    if (next !== value) void onCommit(next)
  }
  return (
    <input
      type="number"
      min={0}
      step={1}
      value={v}
      autoFocus
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.currentTarget.blur() }
        if (e.key === 'Escape') { setEditing(false); setV(String(value || '')) }
      }}
      onClick={e => e.stopPropagation()}
      className="w-12 text-[10px] font-mono tabular-nums px-1 py-px rounded border border-wm-accent bg-wm-bg-elevated focus:outline-none"
    />
  )
}

function TaskChip({ task }: { task: DevTaskRow }) {
  const cls = task.isComplete
    ? 'bg-wm-success-bg text-wm-success border-wm-success/30'
    : task.isEngaged
      ? 'bg-wm-tone-blue-bg text-wm-tone-blue border-wm-tone-blue/40 font-semibold'
      : 'bg-wm-bg text-wm-text-muted border-wm-border'
  const minutes = Number(task.time_estimate_minutes ?? 0)
  const label = minutes > 0 ? `${Math.round(minutes / 60 * 10) / 10}h` : ''
  return (
    <a
      href={`https://app.clickup.com/t/${CLICKUP_TEAM_ID}/${task.task_id}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`${task.task_name} · ${task.current_status ?? 'no status'}${label ? ` · ${label}` : ''}`}
      className={[
        'inline-flex items-center justify-between gap-1 rounded-[3px] border px-1 py-[1px] truncate',
        'text-[9px] leading-none hover:brightness-110',
        cls,
      ].join(' ')}
    >
      <span className="truncate">{task.task_name}</span>
      <ExternalLink size={8} className="shrink-0 opacity-70" />
    </a>
  )
}
