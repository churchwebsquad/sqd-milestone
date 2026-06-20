/**
 * Web Manager — Dev capacity banner.
 *
 * One-strip summary at the top of /web that answers Ashley's main
 * resourcing question: "is dev overbooked right now, and what's
 * coming?" Surfaces:
 *   • This sprint  — allocated vs cap, # of active projects
 *   • Next sprint  — same, lookahead
 *   • Two sprints out — same, longer lookahead
 *
 * Per Ashley (2026-06-19): "dev matters most so if you have to invest
 * time somewhere invest it in dev." This banner is dev-only — squad
 * wide content/design capacity will surface elsewhere if/when needed.
 */
import { useMemo } from 'react'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import { sprintsFrom } from '../../../lib/webPlanningMath'
import { weekStart, toIsoDate, addWeeks, fromIsoDate } from '../../../lib/dateRange'
import { DEFAULT_DEV_CAPACITY } from '../../../lib/webProjectHealth'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'

interface Props {
  rows: ProjectRowVM[]
}

interface SprintSummary {
  label:      string
  allocated:  number
  cap:        number
  pct:        number
  over:       number
  projectCt:  number
}

export function DevCapacityBanner({ rows }: Props) {
  // Pin "today" to the ISO day so a page left open past midnight
  // doesn't keep showing yesterday's sprint as "this sprint."
  const todayISO = toIsoDate(new Date())
  const summaries = useMemo<SprintSummary[]>(() => {
    const today = fromIsoDate(todayISO)!
    const sprints = sprintsFrom(today, 3)
    const cap = DEFAULT_DEV_CAPACITY * 2  // 2-week sprint
    return sprints.map(s => {
      const sprintStart = fromIsoDate(s.startISO)!
      const w0 = toIsoDate(weekStart(sprintStart))
      const w1 = toIsoDate(weekStart(addWeeks(sprintStart, 1)))
      let allocated = 0
      const projectsTouched = new Set<string>()
      for (const r of rows) {
        for (const a of r.allocations ?? []) {
          if (a.week_starting === w0 || a.week_starting === w1) {
            const h = Number(a.hours)
            if (h > 0) {
              allocated += h
              projectsTouched.add(r.id)
            }
          }
        }
      }
      return {
        label:     s.label,
        allocated: Math.round(allocated * 10) / 10,
        cap,
        pct:       Math.min(100, Math.round((allocated / cap) * 100)),
        over:      Math.max(0, Math.round((allocated - cap) * 10) / 10),
        projectCt: projectsTouched.size,
      }
    })
  }, [rows, todayISO])

  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated p-3 mb-4">
      <div className="flex items-baseline gap-1.5 mb-2 flex-wrap">
        <TrendingUp size={13} className="text-wm-accent self-center" />
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text">Dev capacity outlook</p>
        <span className="text-[10.5px] text-wm-text-subtle ml-1">
          · {Math.round(DEFAULT_DEV_CAPACITY)}h/week per dev (35h minus context-switch buffer)
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {summaries.map((s, i) => {
          const isOver  = s.over > 0
          const isNear  = !isOver && s.pct >= 80
          const dotBg = isOver ? 'bg-rose-500' : isNear ? 'bg-amber-400' : 'bg-emerald-400'
          const valueColor = isOver ? 'text-rose-700' : isNear ? 'text-amber-700' : 'text-wm-text'
          // Over-cap card earns a left rail + tinted bg so it's the
          // loudest pixel in the banner. Under/near-cap cards stay
          // neutral.
          const cardChrome =
            isOver ? 'border-rose-300 border-l-[6px] border-l-rose-500 bg-rose-50/60'
          : isNear ? 'border-amber-300 bg-wm-bg'
                   : 'border-wm-border bg-wm-bg'
          return (
            <div
              key={s.label}
              className={`rounded-md border ${cardChrome} p-2.5`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10.5px] font-semibold text-wm-text-muted">
                  {i === 0 ? 'This sprint' : i === 1 ? 'Next sprint' : 'Sprint +2'}
                </p>
                <span className="text-[9.5px] font-mono text-wm-text-subtle">
                  {s.label}
                </span>
              </div>
              {isOver && (
                // Promote the over-cap signal: large rose alert chip
                // sits above the hours bar.
                <div className="flex items-center gap-1.5 mb-2 bg-rose-100 text-rose-800 rounded-md px-2 py-1">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span className="text-[13px] font-bold font-mono">Over by {s.over}h</span>
                </div>
              )}
              <div className="flex items-baseline gap-1.5 mb-1.5">
                <span className={`text-[18px] font-bold font-mono ${valueColor}`}>
                  {s.allocated}h
                </span>
                <span className="text-[10.5px] font-mono text-wm-text-subtle">/ {s.cap}h</span>
                <span className={`ml-auto text-[10.5px] font-mono font-semibold ${valueColor}`}>
                  {s.pct}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-wm-border rounded-full overflow-hidden">
                <div
                  className={`h-full ${dotBg}`}
                  style={{ width: `${s.pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[10px] text-wm-text-muted">
                <span>{s.projectCt} project{s.projectCt === 1 ? '' : 's'}</span>
                {!isOver && (
                  <span className="text-wm-text-subtle">{Math.round((s.cap - s.allocated) * 10) / 10}h free</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
