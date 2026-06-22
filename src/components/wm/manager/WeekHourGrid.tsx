/**
 * Week-Hour Grid — the central planning artifact for /web.
 *
 * 2D matrix:
 *   - Columns: 16 weeks ahead (next sprint planning horizon)
 *   - Rows:    every active project, ordered by priority
 *   - Cells:   hours allocated to each project that week
 *
 * Cells are EDITABLE. Each cell shows either:
 *   1. A manual override saved in strategy_dev_weekly_allocations
 *      (bold, deep plum), or
 *   2. A queue projection from computeDevQueue.weeklyHours
 *      (regular, mid-purple, italic)
 *
 * Typing in a cell upserts the override on blur. Clearing it (empty
 * or 0) deletes the override, reverting to the projected number.
 *
 * Column footer = sum of every displayed cell that week, red when
 * over the team cap (default 35h). Sticky right column shows each
 * project's predicted launch + days vs target.
 *
 * Note on the math: the queue projection ignores manual overrides
 * in v1 — overrides are visibility/commitment markers, not a way
 * to FORCE the queue to skip a week. Weaving overrides into
 * computeDevQueue is a follow-up.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'
import { weekStart, addWeeks, toIsoDate, fromIsoDate, daysBetween } from '../../../lib/dateRange'

interface Props {
  rows:            ProjectRowVM[]
  capacityPerWeek: number
  /** How many weeks ahead to render. Default 16 (~ a quarter). */
  weeksAhead?:     number
}

interface AllocationRow {
  web_project_id: string
  week_starting:  string  // ISO yyyy-mm-dd
  hours:          number
}

export function WeekHourGrid({
  rows, capacityPerWeek, weeksAhead = 16,
}: Props) {
  // Build the week column list — sticky 16 weeks starting from this Sunday.
  const weeks = useMemo(() => {
    const out: { iso: string; label: string }[] = []
    let w = weekStart(new Date())
    for (let i = 0; i < weeksAhead; i++) {
      const iso = toIsoDate(w)
      out.push({ iso, label: shortMonthDay(w) })
      w = addWeeks(w, 1)
    }
    return out
  }, [weeksAhead])

  // Filter + order projects: active only, by priority asc (nulls last).
  const ordered = useMemo(() => {
    return rows
      .filter(r => !r.archived && r.current_phase !== 'launched')
      .sort((a, b) => {
        const pa = a.priority_order ?? Number.POSITIVE_INFINITY
        const pb = b.priority_order ?? Number.POSITIVE_INFINITY
        if (pa !== pb) return pa - pb
        return (a.church_name ?? a.name ?? '').localeCompare(b.church_name ?? b.name ?? '')
      })
  }, [rows])

  const firstWeekISO = weeks[0]?.iso ?? ''
  const lastWeekISO  = weeks[weeks.length - 1]?.iso ?? ''
  const projectIds   = useMemo(() => ordered.map(r => r.id), [ordered])

  // Load manual overrides from strategy_dev_weekly_allocations for
  // the visible projects + week range. Refetches when scope changes.
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map())
  const [savingCell, setSavingCell] = useState<string | null>(null)
  const overrideKey = (projectId: string, weekISO: string) => `${projectId}::${weekISO}`

  useEffect(() => {
    let cancelled = false
    if (projectIds.length === 0 || !firstWeekISO || !lastWeekISO) return
    void (async () => {
      const { data } = await supabase
        .from('strategy_dev_weekly_allocations')
        .select('web_project_id, week_starting, hours')
        .in('web_project_id', projectIds)
        .gte('week_starting', firstWeekISO)
        .lte('week_starting', lastWeekISO)
      if (cancelled || !data) return
      const next = new Map<string, number>()
      for (const a of (data as AllocationRow[])) {
        next.set(overrideKey(a.web_project_id, a.week_starting), Number(a.hours))
      }
      setOverrides(next)
    })()
    return () => { cancelled = true }
  }, [projectIds, firstWeekISO, lastWeekISO])

  /** Get the effective value for a cell — override if set, else queue
   *  projection. Used for both display and column totals. */
  const cellHours = useCallback((projectId: string, weekISO: string): {
    value:    number
    source:   'override' | 'projection' | 'none'
  } => {
    const k = overrideKey(projectId, weekISO)
    if (overrides.has(k)) {
      return { value: overrides.get(k) ?? 0, source: 'override' }
    }
    const row = ordered.find(r => r.id === projectId)
    const projected = row?.queueSlot?.weeklyHours?.[weekISO] ?? 0
    return projected > 0
      ? { value: projected, source: 'projection' }
      : { value: 0, source: 'none' }
  }, [overrides, ordered])

  /** Save / clear a manual override. Empty or 0 deletes the row. */
  const saveCell = useCallback(async (projectId: string, weekISO: string, raw: string) => {
    const key = overrideKey(projectId, weekISO)
    setSavingCell(key)
    try {
      const trimmed = raw.trim()
      const next = trimmed === '' ? null : Number(trimmed)
      if (next == null || !Number.isFinite(next) || next <= 0) {
        // Delete override → revert to queue projection.
        await supabase
          .from('strategy_dev_weekly_allocations')
          .delete()
          .eq('web_project_id', projectId)
          .eq('week_starting', weekISO)
          .eq('slot', 'primary')
        setOverrides(prev => {
          const m = new Map(prev)
          m.delete(key)
          return m
        })
      } else {
        await supabase
          .from('strategy_dev_weekly_allocations')
          .upsert({
            web_project_id: projectId,
            week_starting:  weekISO,
            slot:           'primary',
            hours:          next,
            updated_at:     new Date().toISOString(),
          }, { onConflict: 'web_project_id,week_starting,slot' })
        setOverrides(prev => {
          const m = new Map(prev)
          m.set(key, next)
          return m
        })
      }
    } finally {
      setSavingCell(null)
    }
  }, [])

  // Compute column totals across all projects using the EFFECTIVE
  // (override-or-projection) value, so the cap check reflects what
  // the user sees on the screen.
  const columnTotals = useMemo(() => {
    const out: Record<string, number> = {}
    for (const wk of weeks) out[wk.iso] = 0
    for (const r of ordered) {
      for (const wk of weeks) {
        out[wk.iso] += cellHours(r.id, wk.iso).value
      }
    }
    return out
  }, [ordered, weeks, cellHours])

  // Anchor today for the column highlighting.
  const todayWeekISO = useMemo(() => toIsoDate(weekStart(new Date())), [])

  if (ordered.length === 0) {
    return (
      <div className="rounded-2xl border border-lavender bg-white px-4 py-8 text-center text-sm text-purple-gray">
        No active projects to schedule.
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-lavender bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-lavender bg-lavender-tint/30 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">
            Weekly dev allocation
          </p>
          <p className="text-sm font-semibold text-deep-plum mt-0.5">
            {ordered.length} active project{ordered.length === 1 ? '' : 's'} · cap {capacityPerWeek}h/wk · next {weeksAhead} weeks
          </p>
        </div>
        <p className="text-[11px] text-purple-gray max-w-md text-right">
          Click any cell to pin hours. Red columns are over the {capacityPerWeek}h cap.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="text-left">
              <th className="sticky left-0 bg-white border-b border-lavender px-3 py-2 font-bold text-[10px] uppercase tracking-widest text-purple-gray min-w-[180px]">
                Project
              </th>
              {weeks.map(wk => (
                <th
                  key={wk.iso}
                  className={`border-b border-lavender px-2 py-2 text-center font-mono tabular-nums text-[10px] ${
                    wk.iso === todayWeekISO
                      ? 'bg-lavender-tint/60 text-deep-plum font-bold'
                      : 'text-purple-gray'
                  }`}
                >
                  {wk.label}
                </th>
              ))}
              <th className="sticky right-0 bg-white border-b border-lavender px-3 py-2 font-bold text-[10px] uppercase tracking-widest text-purple-gray min-w-[140px] text-right">
                Predicted launch
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(r => {
              const slot = r.queueSlot
              const launchTarget = r.launch_date ? fromIsoDate(r.launch_date) : null
              const predicted = slot?.devEndDate ? fromIsoDate(slot.devEndDate) : null
              const gapDays = launchTarget && predicted ? daysBetween(predicted, launchTarget) : null
              return (
                <tr key={r.id} className="hover:bg-lavender-tint/15">
                  <td className="sticky left-0 bg-white hover:bg-lavender-tint/15 border-b border-lavender/60 px-3 py-2 align-top">
                    <Link
                      to={`/web/${r.id}?tab=planning`}
                      className="text-[12.5px] font-semibold text-deep-plum hover:text-primary-purple inline-flex items-center gap-1"
                    >
                      {r.church_name ?? r.name ?? r.id.slice(0, 8)}
                      <ArrowRight size={10} className="opacity-50" />
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-purple-gray">
                      <span className="font-mono">#{r.priority_order ?? '?'}</span>
                      <span>·</span>
                      <span>{r.current_phase}</span>
                      {r.launch_date && (
                        <>
                          <span>·</span>
                          <span>target {shortDate(r.launch_date)}</span>
                        </>
                      )}
                    </div>
                  </td>
                  {weeks.map(wk => {
                    const cell = cellHours(r.id, wk.iso)
                    const key = overrideKey(r.id, wk.iso)
                    return (
                      <td
                        key={wk.iso}
                        className="border-b border-lavender/60 px-1 py-1 text-center"
                      >
                        <HourCell
                          value={cell.value}
                          source={cell.source}
                          saving={savingCell === key}
                          onCommit={(raw) => void saveCell(r.id, wk.iso, raw)}
                        />
                      </td>
                    )
                  })}
                  <td className="sticky right-0 bg-white hover:bg-lavender-tint/15 border-b border-lavender/60 px-3 py-2 text-right align-top">
                    <p className="text-[12px] font-semibold text-deep-plum">
                      {slot?.devEndDate ? shortDate(slot.devEndDate) : '—'}
                    </p>
                    {gapDays != null && (
                      <p className={`text-[10px] mt-0.5 ${
                        gapDays >= 0
                          ? 'text-green-700'
                          : 'text-red-700 font-semibold'
                      }`}>
                        {gapDays >= 0 ? `+${gapDays}d cushion` : `${Math.abs(gapDays)}d late`}
                      </p>
                    )}
                    {slot && slot.remainingDevHours > 0 && (
                      <p className="text-[10px] text-purple-gray mt-0.5">
                        {round1(slot.remainingDevHours)}h remaining
                      </p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 bg-cream/60 border-t-2 border-lavender px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-purple-gray">
                Hours used / {capacityPerWeek}h cap
              </td>
              {weeks.map(wk => {
                const total = columnTotals[wk.iso] ?? 0
                const over = total > capacityPerWeek
                const utilPct = Math.round((total / capacityPerWeek) * 100)
                return (
                  <td
                    key={wk.iso}
                    className={`border-t-2 border-lavender px-2 py-2 text-center font-mono tabular-nums text-[11px] ${
                      over
                        ? 'bg-red-50 text-red-700 font-bold'
                        : total > 0
                          ? 'bg-cream/60 text-deep-plum font-semibold'
                          : 'bg-cream/60 text-purple-gray/40'
                    }`}
                    title={`${round1(total)}h of ${capacityPerWeek}h cap (${utilPct}%)`}
                  >
                    {total > 0 ? round1(total) : '·'}
                  </td>
                )
              })}
              <td className="sticky right-0 bg-cream/60 border-t-2 border-lavender px-3 py-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-lavender bg-lavender-tint/15 text-[10px] text-purple-gray space-y-0.5">
        <p>
          <span className="italic">Italic mid-purple</span> = queue projection from <code className="font-mono text-deep-plum">computeDevQueue</code> (priority × remaining hours × {capacityPerWeek}h pool).
          <span className="font-semibold text-deep-plum"> Bold deep-plum</span> = your manual override (saved to <code className="font-mono">strategy_dev_weekly_allocations</code>).
        </p>
        <p>
          Type a number to pin a week. Clear the cell (or type 0) to revert to the projection. Column totals + the red over-cap warning update from whatever you see in the grid.
        </p>
      </div>
    </div>
  )
}

// ── HourCell — editable per-week-per-project cell ────────────────

function HourCell({
  value, source, saving, onCommit,
}: {
  value:    number
  source:   'override' | 'projection' | 'none'
  saving:   boolean
  onCommit: (raw: string) => void
}) {
  const [draft, setDraft] = useState(value > 0 ? String(round1(value)) : '')
  useEffect(() => {
    setDraft(value > 0 ? String(round1(value)) : '')
  }, [value])
  const displayClass = source === 'override'
    ? 'text-deep-plum font-bold'
    : source === 'projection'
      ? 'text-primary-purple italic'
      : 'text-purple-gray/30'
  return (
    <div className="relative">
      <input
        type="number"
        value={draft}
        min={0}
        step={0.5}
        placeholder={source === 'none' ? '·' : ''}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          // Only commit if the draft differs from what's displayed.
          const cur = value > 0 ? String(round1(value)) : ''
          if (draft !== cur) onCommit(draft)
        }}
        className={`w-12 text-center font-mono tabular-nums text-[12px] py-1.5 rounded border border-transparent focus:border-primary-purple focus:bg-white focus:outline-none hover:bg-lavender-tint/30 ${displayClass}`}
      />
      {saving && (
        <Loader2 size={9} className="absolute top-0.5 right-0.5 animate-spin text-primary-purple" />
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return iso }
}

function shortMonthDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
