/**
 * Web Manager — Launch waterfall.
 *
 * Lays out the next ~10 sprints chronologically. Each sprint row
 * shows the projects whose `launch_date` falls inside the sprint
 * window, with the squad-wide dev hours allocated to that sprint and
 * a capacity overflow surface when the sprint exceeds the weekly cap.
 *
 * Use case (Ashley, 2026-06-19): "I need to see the next eight weeks
 * of launches at a glance — and where dev is overbooked." The Board
 * answers "which projects exist"; the Schedule answers "who's working
 * on what this week"; this view answers "are we going to ship on
 * time, and where will we break?"
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import { WMStatusPill } from '../StatusPill'
import { supabase } from '../../../lib/supabase'
import {
  sprintsFrom,
  deriveSizeTier,
  baseHoursForTier,
  hourRangeForTier,
} from '../../../lib/webPlanningMath'
import { weekStart, toIsoDate, addWeeks, fromIsoDate } from '../../../lib/dateRange'
import { DEFAULT_DEV_CAPACITY } from '../../../lib/webProjectHealth'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'
import type { ProjectSubStatus } from '../../../types/database'

interface Props {
  rows:     ProjectRowVM[]
  loading:  boolean
  onSelect: (projectId: string) => void
}

const SPRINT_COUNT = 10  // ~20 weeks of forward visibility.

const SUB_TONE: Record<ProjectSubStatus, Parameters<typeof WMStatusPill>[0]['tone']> = {
  on_track: 'success', ahead: 'turquoise', off_track: 'warning',
  blocked: 'danger', complete: 'neutral',
}
const SUB_LABEL: Record<ProjectSubStatus, string> = {
  on_track: 'On track', ahead: 'Ahead', off_track: 'Off track',
  blocked: 'Blocked', complete: 'Complete',
}

interface SprintBucket {
  startISO: string
  endISO:   string
  label:    string
  launches: ProjectRowVM[]
  /** Dev hours allocated to weeks inside this sprint (sum across all
   *  projects, all 2 weeks). The cap is 2 × DEFAULT_DEV_CAPACITY. */
  allocatedHours: number
  cap:            number
  overHours:      number
}

export function WaterfallView({ rows, loading, onSelect }: Props) {
  // Bulk-load page counts for every project — one query, grouped in JS.
  // Tier is auto-derived from sitemap page count, then passed to the
  // hour-range helpers for each launch card.
  //
  // Stable key (sorted id-join) so the effect doesn't refetch on every
  // parent rerender — only when the *set* of projects actually changes.
  const projectIdsKey = useMemo(
    () => rows.map(r => r.id).sort().join(','),
    [rows],
  )
  const [pageCounts, setPageCounts] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    const ids = projectIdsKey ? projectIdsKey.split(',') : []
    if (ids.length === 0) {
      setPageCounts(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('web_pages')
        .select('web_project_id')
        .in('web_project_id', ids)
      if (cancelled) return
      const counts = new Map<string, number>()
      for (const row of (data ?? []) as Array<{ web_project_id: string }>) {
        counts.set(row.web_project_id, (counts.get(row.web_project_id) ?? 0) + 1)
      }
      setPageCounts(counts)
    })()
    return () => { cancelled = true }
  }, [projectIdsKey])

  // Compute today's ISO ONCE per render so sprint windows stay
  // pinned to the calendar day (re-running on every render is cheap,
  // and the parent rerenders on data refresh so we don't go stale).
  const todayISO = toIsoDate(new Date())
  const buckets = useMemo<SprintBucket[]>(() => {
    const today = fromIsoDate(todayISO)!
    const sprints = sprintsFrom(today, SPRINT_COUNT)
    const cap = DEFAULT_DEV_CAPACITY * 2  // 2-week sprint
    return sprints.map(s => {
      const launches = rows.filter(r => {
        if (!r.launch_date) return false
        // launch_date is YYYY-MM-DD; trim any trailing time/timezone suffix
        // before comparing so a launch_date with a stray timestamp can't slip past.
        const ld = r.launch_date.slice(0, 10)
        return ld >= s.startISO && ld <= s.endISO
      })
      // Sum allocations whose week_starting falls inside the sprint.
      // Sprint start ISO is already a local-time Sunday; reparse via
      // fromIsoDate (local noon) so weekStart() returns the same Sunday
      // in any timezone.
      const sprintStart = fromIsoDate(s.startISO)!
      const w0 = toIsoDate(weekStart(sprintStart))
      const w1 = toIsoDate(weekStart(addWeeks(sprintStart, 1)))
      let allocatedHours = 0
      for (const r of rows) {
        for (const a of r.allocations ?? []) {
          if (a.week_starting === w0 || a.week_starting === w1) {
            allocatedHours += Number(a.hours)
          }
        }
      }
      return {
        startISO: s.startISO,
        endISO:   s.endISO,
        label:    s.label,
        launches,
        allocatedHours: Math.round(allocatedHours * 10) / 10,
        cap,
        overHours: Math.max(0, allocatedHours - cap),
      }
    })
  }, [rows, todayISO])

  // Unplanned launches: projects with launch_date BEFORE today
  // or with no launch_date at all (we surface them so they don't
  // drop off the view).
  const unplanned = useMemo(() => {
    return rows.filter(r => {
      if (!r.launch_date) return true
      return r.launch_date.slice(0, 10) < todayISO
    }).filter(r => r.current_phase !== 'launched')
  }, [rows, todayISO])

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-wm-bg-hover rounded animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Legend strip */}
      <div className="flex items-center gap-4 text-[11px] text-wm-text-muted px-1 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
          Under cap (&lt;80%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
          Approaching cap (80–100%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
          Over capacity
        </span>
        <span className="ml-auto text-wm-text-subtle">
          Cap = {Math.round(DEFAULT_DEV_CAPACITY * 2)}h / 2-week sprint
        </span>
      </div>

      {/* Unplanned bucket — only renders if it's non-empty */}
      {unplanned.length > 0 && (
        <SprintRow
          startISO=""
          endISO=""
          label="Unscheduled / overdue"
          launches={unplanned}
          allocatedHours={null}
          cap={null}
          overHours={0}
          tone="rose"
          subtitle="No launch date set or launch date in the past"
          onSelect={onSelect}
          pageCounts={pageCounts}
        />
      )}

      {buckets.map(b => {
        const pct = b.cap ? b.allocatedHours / b.cap : 0
        const tone: 'emerald' | 'amber' | 'rose' =
          b.overHours > 0 ? 'rose' : pct >= 0.8 ? 'amber' : 'emerald'
        return (
          <SprintRow
            key={b.startISO}
            startISO={b.startISO}
            endISO={b.endISO}
            label={b.label}
            launches={b.launches}
            allocatedHours={b.allocatedHours}
            cap={b.cap}
            overHours={b.overHours}
            tone={tone}
            onSelect={onSelect}
            pageCounts={pageCounts}
          />
        )
      })}
    </div>
  )
}

interface SprintRowProps {
  startISO:       string
  endISO:         string
  label:          string
  launches:       ProjectRowVM[]
  allocatedHours: number | null
  cap:            number | null
  overHours:      number
  tone:           'emerald' | 'amber' | 'rose'
  subtitle?:      string
  onSelect:       (projectId: string) => void
  pageCounts:     Map<string, number>
}

function SprintRow({
  label, launches, allocatedHours, cap, overHours, tone, subtitle, onSelect, pageCounts,
}: SprintRowProps) {
  // Under-cap sprints are visually quiet — neutral chrome, no tone
  // bg. Amber sprints get a soft amber bg + border. Rose (over-cap)
  // sprints get a thick left rail + tinted bg so they're the loudest
  // pixels on the page. The JTBD is "where will we break?" — that
  // signal earns the extra ink.
  const toneBorder =
    tone === 'rose'  ? 'border-rose-300 border-l-[6px] border-l-rose-500'
  : tone === 'amber' ? 'border-amber-300'
                     : 'border-wm-border'
  const toneBg =
    tone === 'rose'  ? 'bg-rose-50/60'
  : tone === 'amber' ? 'bg-amber-50/30'
                     : 'bg-wm-bg-elevated'
  const toneText =
    tone === 'rose'  ? 'text-rose-700'
  : tone === 'amber' ? 'text-amber-700'
                     : 'text-wm-text-muted'

  const pct = cap != null && allocatedHours != null
    ? Math.min(100, Math.round((allocatedHours / cap) * 100))
    : null

  return (
    <div className={`rounded-lg border ${toneBorder} ${toneBg} p-3`}>
      {/* Header: sprint label + capacity bar + capacity numbers */}
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-wm-text">{label}</p>
          {subtitle ? (
            <p className="text-[10.5px] text-wm-text-muted mt-0.5">{subtitle}</p>
          ) : (
            <p className="text-[10.5px] text-wm-text-muted mt-0.5">
              {launches.length === 0
                ? 'No launches'
                : `${launches.length} ${launches.length === 1 ? 'launch' : 'launches'}`}
            </p>
          )}
        </div>
        {cap != null && allocatedHours != null && (
          <div className="flex flex-col items-end gap-1 min-w-[200px]">
            <div className="flex items-center gap-2 text-[11px]">
              <span className={`font-mono font-semibold ${toneText}`}>
                {allocatedHours}h / {cap}h
              </span>
              <span className="text-wm-text-subtle">·</span>
              <span className="font-mono text-wm-text-muted">{pct}%</span>
            </div>
            <div className="w-[200px] h-1.5 bg-wm-border rounded-full overflow-hidden relative">
              <div
                className={`h-full ${tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {overHours > 0 && (
              <div className="flex items-center gap-1 text-[10.5px] text-rose-700 font-semibold">
                <AlertTriangle size={10} />
                <span>Over by {Math.round(overHours * 10) / 10}h</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Launches row — horizontally scrollable on overflow */}
      {launches.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {launches.map(r => {
            const pc = pageCounts.get(r.id) ?? null
            const tier = deriveSizeTier(pc)
            const baseH = baseHoursForTier(tier)
            const range = hourRangeForTier(tier)
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                aria-label={`Open planning for ${r.church_name ?? r.name}`}
                className="text-left rounded-md border border-wm-border bg-wm-bg px-2.5 py-2 hover:border-wm-accent hover:shadow-sm transition-all group min-w-[200px] flex-1 max-w-[280px]"
              >
                <div className="flex items-start justify-between gap-1.5 mb-1">
                  <p className="text-[12px] font-semibold text-wm-text leading-tight truncate flex-1">
                    {r.church_name ?? r.name}
                  </p>
                  <ChevronRight size={11} className="text-wm-text-subtle shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <WMStatusPill tone={SUB_TONE[r.health.subStatus]} size="sm">
                    {SUB_LABEL[r.health.subStatus]}
                  </WMStatusPill>
                </div>
                <div className="text-[10.5px] text-wm-text-muted font-mono">
                  {tier} · {pc != null ? `${pc} pgs` : '~20 pgs est.'} · {baseH}h ({range.likely}h likely)
                </div>
                {r.launch_date && (
                  <div className="text-[10.5px] text-wm-text-subtle">
                    Launch {formatShort(r.launch_date)}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
