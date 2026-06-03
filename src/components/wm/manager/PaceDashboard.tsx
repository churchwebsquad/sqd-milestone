/**
 * Team-level pace strip pinned to the top of /web.
 *
 * Surfaces five at-a-glance signals:
 *   • Capacity this week — hours allocated across the queue vs.
 *     Josh's weekly capacity. Red when over.
 *   • Capacity next 4 weeks — same calc averaged forward.
 *   • Projects at risk — count of off_track + blocked.
 *   • Pipeline velocity — projects launched in the last 90 days.
 *   • AM-pressure list — projects whose launch_date is BEFORE the
 *     computed projection (i.e. unrealistic promises in the queue).
 *
 * Each tile is a button — clicking drills into the matching filter on
 * the board view (via URL params). The strip itself is collapsible so
 * it doesn't eat vertical space when the strategist doesn't need it.
 */
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Activity, CalendarClock, ChevronDown, ChevronUp,
  Layers, Zap,
} from 'lucide-react'
import {
  addWeeks, fromIsoDate, toIsoDate, weekStart,
} from '../../../lib/dateRange'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'

const JOSH_WEEKLY_CAPACITY = 30
const VELOCITY_WINDOW_DAYS = 90

interface Props {
  rows: ProjectRowVM[]
}

export function PaceDashboard({ rows }: Props) {
  const [open, setOpen] = useState(true)
  const [, setParams] = useSearchParams()
  const navigate = useNavigate()
  const today = useMemo(() => new Date(), [])
  const thisWeekIso = useMemo(() => toIsoDate(weekStart(today)), [today])
  const next4WeeksIso = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < 4; i++) out.push(toIsoDate(addWeeks(weekStart(today), i)))
    return out
  }, [today])

  const metrics = useMemo(() => {
    // Capacity this week + next 4
    let thisWeek = 0
    const nextWeeks: Record<string, number> = {}
    for (const iso of next4WeeksIso) nextWeeks[iso] = 0
    for (const r of rows) {
      for (const a of r.allocations) {
        const iso = a.week_starting.slice(0, 10)
        if (iso === thisWeekIso) thisWeek += Number(a.hours)
        if (iso in nextWeeks) nextWeeks[iso] += Number(a.hours)
      }
    }
    const next4Avg = Object.values(nextWeeks).reduce((s, h) => s + h, 0) / 4

    // At-risk count
    const atRisk = rows.filter(r =>
      r.health.subStatus === 'off_track' || r.health.subStatus === 'blocked',
    ).length

    // Pipeline velocity — projects that hit 'launched' in last 90d
    const windowStart = new Date(today)
    windowStart.setDate(windowStart.getDate() - VELOCITY_WINDOW_DAYS)
    const launchedRecently = rows.filter(r => {
      if (r.current_phase !== 'launched') return false
      const u = fromIsoDate(r.updated_at)
      return u != null && u >= windowStart
    }).length

    // AM-pressure list — launch_date earlier than computed projection
    const amPressure = rows.filter(r => {
      const launch = fromIsoDate(r.launch_date)
      const proj   = fromIsoDate(r.health.launchProjection)
      return launch && proj && proj > launch && r.current_phase !== 'launched'
    }).length

    return { thisWeek, next4Avg, atRisk, launchedRecently, amPressure }
  }, [rows, thisWeekIso, next4WeeksIso, today])

  const tone = (over: boolean, warn?: boolean) =>
    over ? 'border-wm-danger/40 bg-wm-danger-bg text-wm-danger'
    : warn ? 'border-wm-warning/40 bg-wm-warning-bg text-wm-warning'
    : 'border-wm-border bg-wm-bg-elevated text-wm-text'

  if (rows.length === 0) return null

  return (
    <div className="rounded-xl border border-wm-border bg-wm-bg-elevated">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-wm-bg-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-wm-accent" />
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            Team pace
          </p>
          {!open && (
            <span className="text-[11px] text-wm-text-muted ml-2">
              {metrics.thisWeek.toFixed(0)}h this week · {metrics.atRisk} at risk · {metrics.amPressure} under pressure
            </span>
          )}
        </div>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 px-3 pb-3">
          <Tile
            icon={<CalendarClock size={13} />}
            label="This week"
            value={`${metrics.thisWeek.toFixed(0)}h`}
            sub={`/ ${JOSH_WEEKLY_CAPACITY}h cap`}
            toneClass={tone(metrics.thisWeek > JOSH_WEEKLY_CAPACITY, metrics.thisWeek > JOSH_WEEKLY_CAPACITY * 0.85)}
          />
          <Tile
            icon={<Layers size={13} />}
            label="Next 4 weeks (avg)"
            value={`${metrics.next4Avg.toFixed(0)}h`}
            sub="weekly average"
            toneClass={tone(metrics.next4Avg > JOSH_WEEKLY_CAPACITY, metrics.next4Avg > JOSH_WEEKLY_CAPACITY * 0.85)}
          />
          <Tile
            icon={<AlertTriangle size={13} />}
            label="At risk"
            value={String(metrics.atRisk)}
            sub={metrics.atRisk === 1 ? 'project off-track or blocked' : 'projects off-track or blocked'}
            toneClass={tone(metrics.atRisk > 3, metrics.atRisk > 0)}
            onClick={() => setParams({ view: 'board', health: 'off_track,blocked' }, { replace: true })}
          />
          <Tile
            icon={<Zap size={13} />}
            label="Velocity"
            value={String(metrics.launchedRecently)}
            sub={`launched in last ${Math.round(VELOCITY_WINDOW_DAYS / 30)}mo`}
            toneClass="border-wm-border bg-wm-bg-elevated text-wm-text"
          />
          <Tile
            icon={<AlertTriangle size={13} />}
            label="Under AM pressure"
            value={String(metrics.amPressure)}
            sub="launch promise before projection"
            toneClass={tone(false, metrics.amPressure > 0)}
            onClick={() => navigate('/web/am-questions')}
          />
        </div>
      )}
    </div>
  )
}

interface TileProps {
  icon:      React.ReactNode
  label:     string
  value:     string
  sub:       string
  toneClass: string
  onClick?:  () => void
}

function Tile({ icon, label, value, sub, toneClass, onClick }: TileProps) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={[
        'rounded-md border px-3 py-2 text-left transition-colors',
        toneClass,
        onClick ? 'hover:opacity-90' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-[18px] font-semibold tabular-nums mt-1 leading-none">{value}</p>
      <p className="text-[10px] opacity-70 mt-0.5">{sub}</p>
    </Wrapper>
  )
}
