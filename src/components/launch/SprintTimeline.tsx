/**
 * Sprint timeline — ported from the prototype.
 *
 * One card per 2-week sprint. Each card shows:
 *   - Sprint label + date range
 *   - Capacity bar segmented by site (colored chip per site)
 *   - Hours scheduled vs effective capacity (e.g. "63/70 hrs")
 *   - Per-week base 35 🔒 + editable + help hours input + designer-out
 *     checkbox + blackout marker
 */
import { useMemo, useState, useEffect } from 'react'
import {
  weekStart, fmtISO, addCal,
  type SchedulerSite, type SchedulerConfig, type SiteSchedule,
  type WeekAdjustment,
} from '../../lib/launchScheduler'
import type { ProjectLaunchRow } from '../../hooks/useLaunchPlan'

const SITE_COLORS = [
  '#513DE5', '#6B5CE7', '#8A6FE8', '#C8841A', '#2E9E6B',
  '#C2453F', '#3D7DE5', '#9B4FD1', '#E5953D', '#1FA39A',
  '#B5519E', '#5D6BE5', '#D16A4F', '#4FA85D', '#8B5CF6',
]

interface Props {
  rows:        ProjectLaunchRow[]
  sites:       SchedulerSite[]
  schedule:    Record<string, SiteSchedule>
  adjustments: WeekAdjustment[]
  cfg:         SchedulerConfig
  /** Per-week upsert into strategy_dev_weekly_allocations. */
  onAdjust:    (a: WeekAdjustment) => Promise<void>
  /** Optional override of how many sprints to render. When unset,
   *  the timeline auto-extends to (last allocated sprint + 3 months
   *  of empty sprints) so the PM can see open capacity ahead. */
  sprintsToShow?: number
}

export function SprintTimeline({
  rows, sites, schedule, adjustments, cfg, onAdjust, sprintsToShow,
}: Props) {
  // Build color map for sites in priority order.
  const colorByProject = useMemo(() => {
    const m: Record<string, string> = {}
    const ordered = [...sites]
      .filter(s => s.status === 'in_progress')
      .sort((a, b) => a.priority - b.priority)
    ordered.forEach((s, i) => { m[s.id] = SITE_COLORS[i % SITE_COLORS.length] })
    return m
  }, [sites])

  // Group consumed hours by week index for the capacity bar fills.
  const allocByWeek = useMemo(() => {
    const out: Record<number, Array<{ projectId: string; hours: number }>> = {}
    for (const [pid, slot] of Object.entries(schedule)) {
      for (const [wkStr, hrs] of Object.entries(slot.alloc)) {
        const wk = Number(wkStr)
        if (!out[wk]) out[wk] = []
        out[wk].push({ projectId: pid, hours: hrs })
      }
    }
    return out
  }, [schedule])

  // Adjustments keyed by week_starting ISO.
  const adjByIso = useMemo(() => {
    const m = new Map<string, WeekAdjustment>()
    for (const a of adjustments) m.set(a.week_starting, a)
    return m
  }, [adjustments])

  const projectName = (id: string) => {
    const r = rows.find(x => x.id === id)
    return r ? (r.church_name ?? r.name) : id.slice(0, 8)
  }

  // How many sprints to render. If the caller didn't pin a count,
  // extend through the LAST sprint that has any allocated work, plus
  // 6 sprints (~3 months at 2-week sprints) of open capacity. That
  // gives the PM a clear "here's the next quarter of headroom" view
  // beyond the active queue.
  const sprintsCount = useMemo(() => {
    if (sprintsToShow != null) return sprintsToShow
    let maxEndWeek = -1
    for (const slot of Object.values(schedule)) {
      if (slot.endWeek > maxEndWeek && Object.keys(slot.alloc).length > 0) {
        maxEndWeek = slot.endWeek
      }
    }
    const lastSprintIdx = maxEndWeek >= 0 ? Math.floor(maxEndWeek / cfg.sprint_weeks) : -1
    const buffer = 6   // 6 two-week sprints = 12 weeks ≈ 3 months
    const total = lastSprintIdx + 1 + buffer
    return Math.max(total, 4)   // floor so an empty queue still shows something
  }, [schedule, cfg.sprint_weeks, sprintsToShow])

  // Build the sprint list.
  const sprints: Array<{ idx: number; startWeek: number; endWeek: number }> = []
  for (let s = 0; s < sprintsCount; s++) {
    sprints.push({ idx: s, startWeek: s * cfg.sprint_weeks, endWeek: s * cfg.sprint_weeks + (cfg.sprint_weeks - 1) })
  }

  return (
    <div className="rounded-2xl border border-lavender bg-white overflow-hidden mt-4">
      <div className="px-4 py-3 border-b border-lavender bg-lavender-tint/30">
        <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">Development sprint timeline</p>
        <p className="text-sm text-purple-gray mt-0.5">
          Each week starts at the team default <strong className="text-deep-plum">{cfg.base_weekly_cap}h base</strong>;
          edit per week when the dev is out part of the week (e.g. one day off → 28h).
          Stack extra <em>help</em> hours on top when a designer can offload work. Mark
          <em>designer out</em> to drop help that week, or <em>blackout</em> to zero the
          whole week. Cards auto-extend 3 months past the last allocated sprint so you
          can see open capacity ahead.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4">
        {sprints.map(sp => (
          <SprintCard
            key={sp.idx}
            sprintIdx={sp.idx}
            startWeek={sp.startWeek}
            endWeek={sp.endWeek}
            cfg={cfg}
            allocByWeek={allocByWeek}
            adjByIso={adjByIso}
            colorByProject={colorByProject}
            projectName={projectName}
            onAdjust={onAdjust}
          />
        ))}
      </div>
    </div>
  )
}

// ── Sprint card ──────────────────────────────────────────────────

function SprintCard({
  sprintIdx, startWeek, endWeek, cfg, allocByWeek, adjByIso,
  colorByProject, projectName, onAdjust,
}: {
  sprintIdx:       number
  startWeek:       number
  endWeek:         number
  cfg:             SchedulerConfig
  allocByWeek:     Record<number, Array<{ projectId: string; hours: number }>>
  adjByIso:        Map<string, WeekAdjustment>
  colorByProject:  Record<string, string>
  projectName:     (id: string) => string
  onAdjust:        (a: WeekAdjustment) => Promise<void>
}) {
  // Sprint span dates.
  const sprintStart = weekStart(startWeek, cfg)
  const sprintEnd   = addCal(weekStart(endWeek, cfg), 6)

  // Per-week effective capacity. base_capacity_override (when set)
  // replaces the team default 35h base; help_hours stack on top
  // unless designer_out; is_blackout zeros the whole week.
  const weeks: Array<{ idx: number; iso: string; cap: number; hours: number; adj: WeekAdjustment | null }> = []
  let sprintCap = 0
  let sprintHours = 0
  for (let i = startWeek; i <= endWeek; i++) {
    const wk = weekStart(i, cfg)
    const iso = fmtISO(wk)
    const adj = adjByIso.get(iso) ?? null
    const base = adj?.base_capacity != null ? adj.base_capacity : cfg.base_weekly_cap
    const cap = adj?.is_blackout
      ? 0
      : Math.max(0, base + (adj?.designer_out ? 0 : (adj?.help_hours ?? 0)))
    const hrs = (allocByWeek[i] ?? []).reduce((s, x) => s + x.hours, 0)
    weeks.push({ idx: i, iso, cap, hours: hrs, adj })
    sprintCap += cap
    sprintHours += hrs
  }

  // Aggregate per-project hours across the sprint for the capacity bar.
  const sprintAlloc = new Map<string, number>()
  for (let i = startWeek; i <= endWeek; i++) {
    for (const a of (allocByWeek[i] ?? [])) {
      sprintAlloc.set(a.projectId, (sprintAlloc.get(a.projectId) ?? 0) + a.hours)
    }
  }
  const sprintAllocs = Array.from(sprintAlloc.entries()).map(([id, h]) => ({ id, hours: h }))
  const isFull = sprintCap > 0 && sprintHours >= sprintCap

  return (
    <div className="rounded-xl border border-lavender bg-cream/30">
      <div className="px-4 pt-3 pb-2">
        <p className="text-[14px] font-bold text-deep-plum">
          {sprintStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
          {' – '}
          {sprintEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
        </p>
        <p className="text-[11px] uppercase tracking-widest font-bold text-purple-gray mt-0.5">
          Dev Sprint {sprintIdx + 1}
        </p>
      </div>

      {/* Capacity bar */}
      <div className="px-4">
        <div className="h-2 w-full rounded bg-lavender-tint overflow-hidden flex">
          {sprintAllocs.map(a => (
            <div
              key={a.id}
              style={{
                width: `${sprintCap > 0 ? (a.hours / sprintCap) * 100 : 0}%`,
                background: colorByProject[a.id] ?? '#A89BE5',
              }}
              title={`${projectName(a.id)} · ${a.hours}h`}
            />
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-purple-gray">
          <span className={isFull ? 'text-red-700 font-semibold' : ''}>
            {sprintHours} hrs scheduled
          </span>
          <span>{sprintCap || 0} hr capacity</span>
        </div>
      </div>

      {/* Per-project allocation rows — one per project, full church
          name + right-aligned hours. This is the PM's "who gets which
          slice of this sprint" read; the old inline-chip layout
          truncated names and was hard to scan. Sorted by hours desc
          so the biggest slice reads first. */}
      {sprintAllocs.length > 0 && (
        <div className="px-4 pt-3 pb-2 space-y-1.5">
          {sprintAllocs
            .slice()
            .sort((a, b) => b.hours - a.hours)
            .map(a => (
              <div key={a.id} className="flex items-center gap-2.5 text-[13px]">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: colorByProject[a.id] ?? '#A89BE5' }}
                />
                <span className="text-deep-plum flex-1 min-w-0">
                  {projectName(a.id)}
                </span>
                <span className="font-mono font-bold text-deep-plum shrink-0">
                  {a.hours}h
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Per-week controls */}
      <div className="px-4 pt-2 pb-3 border-t border-lavender/60 space-y-1.5">
        {weeks.map(w => (
          <WeekControl
            key={w.iso}
            iso={w.iso}
            sprintStart={weekStart(w.idx, cfg)}
            adj={w.adj}
            baseCap={cfg.base_weekly_cap}
            scheduledHours={w.hours}
            onAdjust={onAdjust}
          />
        ))}
      </div>
    </div>
  )
}

function WeekControl({
  iso, sprintStart, adj, baseCap, scheduledHours, onAdjust,
}: {
  iso:            string
  sprintStart:    Date
  adj:            WeekAdjustment | null
  baseCap:        number
  scheduledHours: number
  onAdjust:       (a: WeekAdjustment) => Promise<void>
}) {
  const [helpDraft, setHelpDraft] = useState(String(adj?.help_hours ?? ''))
  useEffect(() => { setHelpDraft(String(adj?.help_hours ?? '')) }, [adj?.help_hours])
  // base capacity draft — null/'' means "use team default 35h"; any
  // number means "override base for this week to N hours."
  const [baseDraft, setBaseDraft] = useState<string>(adj?.base_capacity != null ? String(adj.base_capacity) : '')
  useEffect(() => {
    setBaseDraft(adj?.base_capacity != null ? String(adj.base_capacity) : '')
  }, [adj?.base_capacity])
  const designerOut = !!adj?.designer_out
  const blackout    = !!adj?.is_blackout
  const baseOverridden = adj?.base_capacity != null

  const commit = (next: Partial<WeekAdjustment>) => {
    void onAdjust({
      week_starting: iso,
      help_hours:    next.help_hours    ?? adj?.help_hours   ?? 0,
      designer_out:  next.designer_out  ?? adj?.designer_out ?? false,
      is_blackout:   next.is_blackout   ?? adj?.is_blackout  ?? false,
      base_capacity: next.base_capacity !== undefined
        ? next.base_capacity
        : (adj?.base_capacity ?? null),
    })
  }

  return (
    <div className={`flex items-center justify-between gap-2 text-[10.5px] ${blackout ? 'opacity-50' : ''}`}>
      <div className="text-purple-gray font-mono">
        {sprintStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
      </div>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <span className={`inline-flex items-center gap-1 ${baseOverridden ? 'text-amber-800' : 'text-deep-plum'}`}>
          <span className="text-[9px] uppercase font-bold tracking-widest">base</span>
          <input
            type="number"
            min={0}
            max={80}
            placeholder={String(baseCap)}
            value={baseDraft}
            onChange={e => setBaseDraft(e.target.value)}
            onBlur={() => {
              const trimmed = baseDraft.trim()
              const next = trimmed === '' ? null : Number(trimmed)
              const current = adj?.base_capacity ?? null
              const finalVal = next != null && Number.isFinite(next) && next >= 0 ? next : null
              if (finalVal !== current) commit({ base_capacity: finalVal })
            }}
            disabled={blackout}
            title={`Override the team default ${baseCap}h base for this week (e.g. dev out one day → 28h). Leave blank to use ${baseCap}h.`}
            className={`w-12 text-center font-mono px-1 py-0.5 rounded border focus:border-primary-purple focus:outline-none disabled:bg-cream disabled:text-purple-gray/40 ${baseOverridden ? 'border-amber-400 bg-amber-50' : 'border-lavender'}`}
          />
          <span className="text-[9px]">h</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="text-[9px] text-emerald-700 font-bold uppercase">+ help</span>
          <input
            type="number"
            min={0}
            max={35}
            value={helpDraft}
            onChange={e => setHelpDraft(e.target.value)}
            onBlur={() => {
              const next = helpDraft.trim() === '' ? 0 : Number(helpDraft) || 0
              if (next !== (adj?.help_hours ?? 0)) commit({ help_hours: next })
            }}
            disabled={designerOut || blackout}
            className="w-12 text-center font-mono px-1 py-0.5 rounded border border-lavender disabled:bg-cream disabled:text-purple-gray/40 focus:border-primary-purple focus:outline-none"
          />
        </span>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={designerOut}
            onChange={e => commit({ designer_out: e.target.checked })}
            className="accent-red-500"
          />
          <span className="text-red-700 font-semibold">designer out</span>
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={blackout}
            onChange={e => commit({ is_blackout: e.target.checked })}
            className="accent-purple-700"
          />
          <span className="text-purple-gray font-semibold">blackout</span>
        </label>
        <span className="font-mono text-purple-gray min-w-[40px] text-right">{scheduledHours}h</span>
      </div>
    </div>
  )
}
