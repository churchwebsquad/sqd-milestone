/**
 * Web Manager — Calendar overlay.
 *
 * Month grid that lays every site's planned launch date plus the
 * soft partner-review targets (R1 / R2) per current phase against a
 * single timeline. Strategist's job-to-be-done:
 *   • "Which week has the most launches?" → density per cell.
 *   • "Which sites have partner-review windows this month?" → dashed
 *     R1/R2 chips.
 *   • "Are launches stacked into the same Friday?" → visible cluster.
 *
 * Launches render as solid pills (hard date). Review targets render
 * as dashed-outline chips (soft — cadence guidance, not deadline).
 */
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { reviewTargetsForPhase } from '../../../lib/webPlanningMath'
import { toIsoDate } from '../../../lib/dateRange'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'
import type { WebProjectPhase } from '../../../types/database'

interface Props {
  rows:     ProjectRowVM[]
  loading:  boolean
  onSelect: (projectId: string) => void
}

/** Per-phase tone for review-target chips. Matches the Phase board. */
const PHASE_REVIEW_TONE: Record<WebProjectPhase, string> = {
  intake:   'border-wm-border text-wm-text-muted',
  content:  'border-blue-300 text-blue-700',
  design:   'border-pink-300 text-pink-700',
  dev:      'border-amber-400 text-amber-700',
  review:   'border-purple-300 text-purple-700',
  launched: 'border-emerald-300 text-emerald-700',
}

interface CellMarker {
  kind: 'launch' | 'review'
  round?: 'R1' | 'R2'
  projectId: string
  label: string
  phase?: WebProjectPhase
}

export function CalendarView({ rows, loading, onSelect }: Props) {
  const [cursor, setCursor] = useState<Date>(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  // Compute markers per yyyy-mm-dd cell.
  const markersByDay = useMemo(() => {
    const map = new Map<string, CellMarker[]>()
    for (const r of rows) {
      // Hard launch date.
      if (r.launch_date) {
        const key = r.launch_date
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push({
          kind: 'launch',
          projectId: r.id,
          label: r.church_name ?? r.name,
        })
      }
      // Soft review targets — derived from current phase + a phase-start
      // proxy. Use latest_milestone_at as the phase entry point; if it
      // is missing, skip review markers for that project. Trim the
      // timestamptz to YYYY-MM-DD before passing through — using
      // `new Date(ts).toIsoDate()` would shift the day when the
      // timestamp is late-evening UTC (5pm PT onward).
      const phase = (r.current_phase ?? null) as WebProjectPhase | null
      if (phase && r.latest_milestone_at) {
        const phaseStartISO = r.latest_milestone_at.slice(0, 10)
        const targets = reviewTargetsForPhase(phase, phaseStartISO)
        for (const t of targets) {
          if (!map.has(t.targetISO)) map.set(t.targetISO, [])
          map.get(t.targetISO)!.push({
            kind: 'review',
            round: t.round,
            projectId: r.id,
            label: r.church_name ?? r.name,
            phase,
          })
        }
      }
    }
    return map
  }, [rows])

  // Build the 6-row × 7-col month grid (always 42 cells; leading +
  // trailing cells from neighboring months keep the visual rhythm).
  const cells = useMemo(() => {
    const year  = cursor.getFullYear()
    const month = cursor.getMonth()
    const firstOfMonth = new Date(year, month, 1)
    const lead = firstOfMonth.getDay()  // 0=Sun (codebase convention is Sunday-aligned weeks)
    const start = new Date(year, month, 1 - lead)
    const out: Array<{ date: Date; iso: string; inMonth: boolean; isToday: boolean }> = []
    const todayISO = toIsoDate(new Date())
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      out.push({
        date: d,
        iso,
        inMonth: d.getMonth() === month,
        isToday: iso === todayISO,
      })
    }
    return out
  }, [cursor])

  const monthLabel = cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-wm-bg-hover rounded animate-pulse" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 42 }).map((_, i) => (
            <div key={i} className="h-24 bg-wm-bg-hover rounded animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header: month nav + legend */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            className="rounded-md p-1.5 hover:bg-wm-bg-hover text-wm-text-muted"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <p className="text-[14px] font-bold text-wm-text min-w-[160px] text-center">{monthLabel}</p>
          <button
            type="button"
            onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            className="rounded-md p-1.5 hover:bg-wm-bg-hover text-wm-text-muted"
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              const t = new Date()
              setCursor(new Date(t.getFullYear(), t.getMonth(), 1))
            }}
            className="ml-2 rounded-md px-2 py-1 text-[11px] font-semibold text-wm-text-muted hover:bg-wm-bg-hover"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-wm-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />
            Launch (hard date)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm border-2 border-dashed border-amber-400" />
            Partner review target (soft)
          </span>
          <span className="text-wm-text-subtle">
            R1 = first review · R2 = final review
          </span>
        </div>
      </div>

      {/* Weekday header — hidden below sm in favor of agenda fallback */}
      <div className="hidden sm:grid grid-cols-7 gap-1 text-[10.5px] uppercase tracking-widest text-wm-text-subtle font-semibold px-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      {/* Mobile agenda fallback — chronological list of cells that
          have any marker. Skips empty days entirely so a phone user
          isn't scrolling through 30 empty squares. */}
      <div className="sm:hidden space-y-1.5">
        {cells.filter(c => c.inMonth && (markersByDay.get(c.iso)?.length ?? 0) > 0).map(cell => {
          const markers = markersByDay.get(cell.iso) ?? []
          return (
            <div key={cell.iso} className={`rounded-md border bg-wm-bg p-2 ${cell.isToday ? 'ring-2 ring-wm-accent' : 'border-wm-border'}`}>
              <p className="text-[11px] font-bold text-wm-text mb-1">
                {cell.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {cell.isToday && <span className="ml-1.5 text-[10px] text-wm-accent">Today</span>}
              </p>
              <div className="flex flex-col gap-1">
                {markers.map(m => (
                  <button
                    key={`${m.kind}-${m.projectId}-${m.round ?? ''}`}
                    type="button"
                    onClick={() => onSelect(m.projectId)}
                    aria-label={m.kind === 'launch' ? `Launch — ${m.label}` : `${m.round} review target for ${m.label}`}
                    className={`text-left rounded-sm px-2 py-1 text-[11px] font-semibold truncate transition-colors ${
                      m.kind === 'launch'
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                        : `border-2 border-dashed bg-wm-bg hover:bg-wm-bg-hover ${m.phase ? PHASE_REVIEW_TONE[m.phase] : 'border-wm-border text-wm-text-muted'}`
                    }`}
                  >
                    {m.kind === 'launch' ? `Launch · ${m.label}` : `${m.round} · ${m.label} (${m.phase})`}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {cells.filter(c => c.inMonth && (markersByDay.get(c.iso)?.length ?? 0) > 0).length === 0 && (
          <p className="text-[12px] text-wm-text-subtle italic text-center py-6">
            No launches or review targets this month.
          </p>
        )}
      </div>

      {/* Desktop 6-row × 7-col grid */}
      <div className="hidden sm:grid grid-cols-7 gap-1">
        {cells.map(cell => {
          const markers = markersByDay.get(cell.iso) ?? []
          const launches = markers.filter(m => m.kind === 'launch')
          const reviews  = markers.filter(m => m.kind === 'review')
          return (
            <div
              key={cell.iso}
              className={`rounded-md border min-h-[96px] p-1.5 flex flex-col gap-1 ${
                cell.inMonth ? 'bg-wm-bg border-wm-border' : 'bg-wm-bg-elevated/40 border-wm-border/50'
              } ${cell.isToday ? 'ring-2 ring-wm-accent' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-semibold ${
                  cell.inMonth ? 'text-wm-text' : 'text-wm-text-subtle'
                } ${cell.isToday ? 'text-wm-accent' : ''}`}>
                  {cell.date.getDate()}
                </span>
                {(launches.length + reviews.length) > 0 && (
                  <span className="text-[9px] font-mono text-wm-text-subtle">
                    {launches.length + reviews.length}
                  </span>
                )}
              </div>
              {/* Visible markers: launches always render first (hard
                  dates win); reviews fill remaining slots. Always
                  reserve at least one slot for a review when both
                  kinds exist on the same cell, so the dashed-chip
                  signal isn't completely hidden. */}
              {(() => {
                const MAX = 4
                const reviewMin = reviews.length > 0 && launches.length >= MAX ? 1 : 0
                const launchVisible = Math.min(launches.length, MAX - reviewMin)
                const reviewVisible = Math.min(reviews.length, MAX - launchVisible)
                const hidden = (launches.length + reviews.length) - (launchVisible + reviewVisible)
                return (
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {launches.slice(0, launchVisible).map(m => (
                      <button
                        key={`l-${m.projectId}`}
                        type="button"
                        onClick={() => onSelect(m.projectId)}
                        className="text-left rounded-sm bg-emerald-500 text-white px-1.5 py-0.5 text-[10px] font-semibold truncate hover:bg-emerald-600 transition-colors"
                        aria-label={`Launch — ${m.label}`}
                        title={`Launch — ${m.label}`}
                      >
                        🚀 {m.label}
                      </button>
                    ))}
                    {reviews.slice(0, reviewVisible).map(m => (
                      <button
                        key={`r-${m.projectId}-${m.round}`}
                        type="button"
                        onClick={() => onSelect(m.projectId)}
                        className={`text-left rounded-sm border-2 border-dashed bg-wm-bg px-1.5 py-0.5 text-[10px] font-semibold truncate hover:bg-wm-bg-hover transition-colors ${m.phase ? PHASE_REVIEW_TONE[m.phase] : 'border-wm-border text-wm-text-muted'}`}
                        aria-label={`${m.round} review target for ${m.label}, ${m.phase ?? 'unknown'} phase`}
                        title={`${m.round} review target — ${m.label} (${m.phase ?? 'unknown'} phase)`}
                      >
                        {m.round} · {m.label}
                      </button>
                    ))}
                    {hidden > 0 && (
                      <span className="text-[9.5px] text-wm-text-subtle font-mono pl-1">
                        +{hidden} more
                      </span>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>
    </div>
  )
}
