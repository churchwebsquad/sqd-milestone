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
import { WMSegmentedToggle } from '../SegmentedToggle'
import {
  addWeeks, formatMonthDay, fromIsoDate, toIsoDate, weekStart,
} from '../../../lib/dateRange'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'
import type { WebProjectPhase } from '../../../types/database'

interface Props {
  rows:     ProjectRowVM[]
  loading:  boolean
  onSelect: (projectId: string) => void
  capacityPerWeek?: number
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

export function ScheduleView({ rows, loading, onSelect, capacityPerWeek = 30 }: Props) {
  const [horizon, setHorizon] = useState<Horizon>('16')

  const weeks = useMemo(() => {
    const start = weekStart(new Date())
    const count = Number(horizon)
    return Array.from({ length: count }, (_, i) => addWeeks(start, i))
  }, [horizon])
  const weekIso = useMemo(() => weeks.map(toIsoDate), [weeks])
  const todayIso = useMemo(() => toIsoDate(weekStart(new Date())), [])

  // Pre-bucket each project's allocations by week_starting for
  // O(1) cell lookups. {projectId -> {iso -> hours}}
  const buckets = useMemo(() => {
    const out = new Map<string, Map<string, number>>()
    for (const r of rows) {
      const inner = new Map<string, number>()
      for (const a of r.allocations) {
        const iso = a.week_starting.slice(0, 10)
        inner.set(iso, (inner.get(iso) ?? 0) + Number(a.hours))
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

  // Sticky-left grid: column 1 (project list) is sticky; columns 2..N
  // are week cells. Use `display: grid` with a fixed left-col width
  // and per-week 64px columns for a Gantt feel.
  const gridTemplate = `260px repeat(${weeks.length}, 64px)`

  return (
    <div className="space-y-3">
      {/* Horizon toggle + capacity legend */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <WMSegmentedToggle<Horizon>
          value={horizon}
          onChange={setHorizon}
          options={[
            { value: '8',  label: 'Next 8w'  },
            { value: '16', label: 'Next 16w' },
            { value: '26', label: 'Next 26w' },
          ]}
        />
        <p className="text-[11px] text-wm-text-muted">
          Capacity baseline: <span className="font-semibold text-wm-text">{capacityPerWeek}h/wk</span>
          {' '}· Red column = over capacity
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
              onSelect={onSelect}
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
  onSelect: (id: string) => void
}

function ProjectRow({ row, weeks, weekIso, todayIso, cells, onSelect }: RowProps) {
  const phase = (row.current_phase || 'intake') as WebProjectPhase
  const tint = PHASE_TINT[phase] ?? PHASE_TINT.intake
  const churchLine = row.church_name || `Member ${row.member}`
  const launchIso = row.launch_date
    ? fromIsoDate(row.launch_date)
      ? toIsoDate(weekStart(fromIsoDate(row.launch_date) as Date))
      : null
    : null

  return (
    <>
      {/* Frozen left cell — project label */}
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        className="sticky left-0 z-10 bg-wm-bg-elevated border-b border-r border-wm-border px-3 py-2 text-left hover:bg-wm-bg-hover transition-colors"
      >
        <p className="text-[10px] uppercase tracking-[0.08em] font-bold text-wm-text-subtle truncate">
          {row.priority_order ? `P${row.priority_order} · ` : ''}{churchLine}
        </p>
        <p className="text-[12px] font-semibold text-wm-text truncate">{row.name}</p>
        <p className="text-[10px] text-wm-text-muted mt-0.5">
          {row.dev_hours_estimate ?? 0}h budget
        </p>
      </button>

      {/* Week cells */}
      {weeks.map((_, i) => {
        const iso = weekIso[i]
        const hours = cells.get(iso) ?? 0
        const isToday  = iso === todayIso
        const isLaunch = iso === launchIso
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onSelect(row.id)}
            title={
              hours > 0
                ? `${hours.toFixed(1)}h · ${phase}`
                : 'No allocation this week'
            }
            className={[
              'border-b border-wm-border/60 h-[52px] grid place-items-center text-[11px] font-mono tabular-nums transition-colors',
              isToday ? 'border-l-2 border-l-wm-tone-orange' : '',
              isLaunch ? 'ring-2 ring-inset ring-wm-success' : '',
              hours > 0 ? `${tint} font-semibold hover:opacity-90` : 'bg-wm-bg hover:bg-wm-bg-hover',
            ].join(' ')}
          >
            {hours > 0 ? `${hours.toFixed(0)}h` : ''}
          </button>
        )
      })}
    </>
  )
}
