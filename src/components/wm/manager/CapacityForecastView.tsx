/**
 * Monthly capacity forecast — 6 months out, aggregated.
 *
 * Different lens from the Waterfall (sprint-level). Here the
 * question is "can we take on 3 more partners in Q3?" Each month
 * shows total committed hours vs total available (DEFAULT_DEV_CAPACITY
 * × weeks-in-month) plus the launch count.
 */
import { useMemo } from 'react'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import { DEFAULT_DEV_CAPACITY } from '../../../lib/webProjectHealth'
import { toIsoDate } from '../../../lib/dateRange'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'

interface Props {
  rows:     ProjectRowVM[]
  loading:  boolean
  onSelect: (projectId: string) => void
}

interface MonthBucket {
  key:        string    // YYYY-MM
  label:      string    // "Jul 2026"
  committed:  number    // sum of dev allocations in this month
  capacity:   number    // weeks × DEFAULT_DEV_CAPACITY
  launches:   ProjectRowVM[]
  /** Number of weeks contained in this month. */
  weeks:      number
}

const FORECAST_MONTHS = 6

export function CapacityForecastView({ rows, loading, onSelect }: Props) {
  const buckets = useMemo<MonthBucket[]>(() => {
    const today = new Date()
    const out: MonthBucket[] = []
    for (let i = 0; i < FORECAST_MONTHS; i++) {
      const start = new Date(today.getFullYear(), today.getMonth() + i, 1)
      const end   = new Date(today.getFullYear(), today.getMonth() + i + 1, 0)
      const key   = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
      const startISO = toIsoDate(start)
      const endISO   = toIsoDate(end)

      // Weeks count: ceil of (days / 7).
      const days  = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
      const weeks = Math.ceil(days / 7)
      const capacity = weeks * DEFAULT_DEV_CAPACITY

      let committed = 0
      const launches: ProjectRowVM[] = []
      for (const r of rows) {
        for (const a of r.allocations ?? []) {
          if (a.week_starting >= startISO && a.week_starting <= endISO) {
            committed += Number(a.hours)
          }
        }
        if (r.launch_date && r.launch_date >= startISO && r.launch_date <= endISO) {
          launches.push(r)
        }
      }
      out.push({
        key, label: start.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
        committed: Math.round(committed * 10) / 10,
        capacity:  Math.round(capacity * 10) / 10,
        launches, weeks,
      })
    }
    return out
  }, [rows])

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-wm-bg-hover rounded animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-2.5">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={13} className="text-wm-accent" />
          <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text">
            6-month capacity forecast
          </p>
          <p className="text-[10.5px] text-wm-text-subtle ml-1">
            · {Math.round(DEFAULT_DEV_CAPACITY)}h/dev/week × weeks-in-month
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {buckets.map(b => {
          const pct = b.capacity > 0 ? Math.round((b.committed / b.capacity) * 100) : 0
          const over = Math.max(0, b.committed - b.capacity)
          const tone: 'emerald' | 'amber' | 'rose' =
            over > 0 ? 'rose' : pct >= 80 ? 'amber' : 'emerald'
          const chrome =
            tone === 'rose'  ? 'border-rose-300 bg-rose-50/40'
          : tone === 'amber' ? 'border-amber-300 bg-amber-50/30'
                             : 'border-wm-border bg-wm-bg'
          const barTone = tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-400'

          return (
            <div key={b.key} className={`rounded-lg border ${chrome} p-3`}>
              <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                <div>
                  <p className="text-[14px] font-bold text-wm-text">{b.label}</p>
                  <p className="text-[10.5px] text-wm-text-muted">
                    {b.weeks} weeks · {b.launches.length} launch{b.launches.length === 1 ? '' : 'es'} planned
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-bold font-mono text-wm-text">
                    {b.committed}h / {b.capacity}h
                  </p>
                  <p className="text-[10.5px] font-mono text-wm-text-muted">{pct}% utilized</p>
                  {over > 0 && (
                    <p className="text-[10.5px] font-mono text-rose-700 font-semibold flex items-center gap-1 justify-end mt-0.5">
                      <AlertTriangle size={9} /> Over by {Math.round(over * 10) / 10}h
                    </p>
                  )}
                </div>
              </div>
              <div className="w-full h-1.5 bg-wm-border rounded-full overflow-hidden mb-2">
                <div className={`h-full ${barTone}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              {b.launches.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {b.launches.map(l => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => onSelect(l.id)}
                      className="text-[10.5px] font-semibold rounded-full border border-wm-border bg-wm-bg px-2 py-0.5 text-wm-text hover:border-wm-accent transition-colors"
                    >
                      {l.church_name ?? l.name} · {l.launch_date?.slice(5)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

