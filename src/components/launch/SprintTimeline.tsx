/**
 * Sprint timeline — phased per-site flow.
 *
 * One card per 2-week sprint. Each card lists the work that happens in
 * that window as a time-ordered flow of phase rows:
 *   - 🟪 BUILD              site · {h}h
 *   - 🟧 PARTNER REVIEW     site · out {start} – {end}
 *   - 🟩 FINAL EDITS + LAUNCH  site · {h}h
 *
 * Reviews are calendar windows (no dev work), so they don't consume
 * the capacity bar — only build + final do. The capacity bar is
 * segmented per site by dev hours scheduled in that sprint.
 *
 * Per-week controls (base override, + help, designer out, blackout)
 * stay on the card.
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

const DAY_MS = 86_400_000

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
  // Color map for sites in priority order. Includes waiting_feedback
  // sites — they show up as 'final edits' rows.
  const colorByProject = useMemo(() => {
    const m: Record<string, string> = {}
    const ordered = [...sites]
      .filter(s => s.status !== 'launched')
      .sort((a, b) => a.priority - b.priority)
    ordered.forEach((s, i) => { m[s.id] = SITE_COLORS[i % SITE_COLORS.length] })
    return m
  }, [sites])

  const priorityByProject = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of sites) m[s.id] = s.priority
    return m
  }, [sites])

  const adjByIso = useMemo(() => {
    const m = new Map<string, WeekAdjustment>()
    for (const a of adjustments) m.set(a.week_starting, a)
    return m
  }, [adjustments])

  const projectName = (id: string) => {
    const r = rows.find(x => x.id === id)
    return r ? (r.church_name ?? r.name) : id.slice(0, 8)
  }

  // Extend through the last sprint that contains any allocated work
  // OR any review window, then add 6 sprints (~3 months) of headroom.
  const sprintsCount = useMemo(() => {
    if (sprintsToShow != null) return sprintsToShow
    let maxEndWeek = -1
    for (const slot of Object.values(schedule)) {
      const reviewEndIdx = slot.reviewEnd
        ? weekIdxOf(slot.reviewEnd, cfg)
        : -1
      const lastTouched = Math.max(slot.endWeek, reviewEndIdx)
      if (lastTouched > maxEndWeek && (Object.keys(slot.alloc).length > 0 || slot.reviewStart)) {
        maxEndWeek = lastTouched
      }
    }
    const lastSprintIdx = maxEndWeek >= 0 ? Math.floor(maxEndWeek / cfg.sprint_weeks) : -1
    const buffer = 6
    const total = lastSprintIdx + 1 + buffer
    return Math.max(total, 4)
  }, [schedule, cfg, sprintsToShow])

  const sprints: Array<{ idx: number; startWeek: number; endWeek: number }> = []
  for (let s = 0; s < sprintsCount; s++) {
    sprints.push({
      idx: s,
      startWeek: s * cfg.sprint_weeks,
      endWeek:   s * cfg.sprint_weeks + (cfg.sprint_weeks - 1),
    })
  }

  return (
    <div className="rounded-2xl border border-lavender bg-white overflow-hidden mt-4">
      <div className="px-4 py-3 border-b border-lavender bg-lavender-tint/30">
        <p className="text-[11px] uppercase tracking-widest font-bold text-primary-purple">Planning</p>
        <h2 className="font-serif text-[22px] text-deep-plum leading-tight mt-1">Development sprint timeline</h2>
        <p className="text-sm text-purple-gray mt-1.5">
          Each site flows <strong className="text-deep-plum">build → partner review → final edits + launch</strong>.
          The dev pivots away during the review pause (default <strong className="text-deep-plum">{cfg.review_days} biz days</strong>;
          weekends don't count), then circles back for the <strong className="text-deep-plum">{cfg.final_hours}h</strong> final pass.
          Capacity bars only count dev work (build + final); reviews are calendar time, not hours.
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
            schedule={schedule}
            adjByIso={adjByIso}
            colorByProject={colorByProject}
            priorityByProject={priorityByProject}
            projectName={projectName}
            onAdjust={onAdjust}
          />
        ))}
      </div>
    </div>
  )
}

// ── Sprint card ──────────────────────────────────────────────────

interface PhaseRow {
  kind:    'build' | 'review' | 'final'
  siteId:  string
  hours?:  number
  /** Review window — only for kind='review'. */
  reviewStart?: Date
  reviewEnd?:   Date
  /** First calendar day this row appears in the sprint window. Drives
   *  vertical ordering so the card reads top-to-bottom as the work
   *  actually happened. */
  sortKey: number
  /** Tie-break when sortKey ties: build < review < final. */
  phaseRank: number
  priority:  number
}

function SprintCard({
  sprintIdx, startWeek, endWeek, cfg, schedule, adjByIso,
  colorByProject, priorityByProject, projectName, onAdjust,
}: {
  sprintIdx:        number
  startWeek:        number
  endWeek:          number
  cfg:              SchedulerConfig
  schedule:         Record<string, SiteSchedule>
  adjByIso:         Map<string, WeekAdjustment>
  colorByProject:   Record<string, string>
  priorityByProject:Record<string, number>
  projectName:      (id: string) => string
  onAdjust:         (a: WeekAdjustment) => Promise<void>
}) {
  const sprintStart   = weekStart(startWeek, cfg)
  const sprintEnd     = addCal(weekStart(endWeek, cfg), 6)
  const sprintEndExcl = addCal(sprintEnd, 1)  // exclusive boundary for overlap math

  // Per-week capacity row data.
  const weeks: Array<{
    idx:                   number
    iso:                   string
    cap:                   number
    hours:                 number
    adj:                   WeekAdjustment | null
    perChurchHelp:         number
    perChurchHelpBySite:   Array<{ siteId: string; hours: number }>
  }> = []
  let sprintCap = 0
  let sprintHours = 0

  // Build phase rows by scanning the schedule.
  const rows: PhaseRow[] = []
  // Capacity bar slices, keyed by site (build + final summed).
  const sprintAlloc = new Map<string, number>()

  for (const [pid, slot] of Object.entries(schedule)) {
    const priority = priorityByProject[pid] ?? 9_999

    // Build allocation in this sprint window.
    let buildH = 0
    let buildFirst: Date | null = null
    for (let w = startWeek; w <= endWeek; w++) {
      const h = slot.buildAllocByWeek[w]
      if (h && h > 0) {
        buildH += h
        const d = slot.firstBuildDayByWeek[w]
        if (d && (!buildFirst || d.getTime() < buildFirst.getTime())) buildFirst = d
      }
    }
    if (buildH > 0) {
      rows.push({
        kind:      'build',
        siteId:    pid,
        hours:     buildH,
        sortKey:   buildFirst ? buildFirst.getTime() : sprintStart.getTime(),
        phaseRank: 0,
        priority,
      })
      sprintAlloc.set(pid, (sprintAlloc.get(pid) ?? 0) + buildH)
      sprintHours += buildH
    }

    // Final allocation in this sprint window.
    let finalH = 0
    let finalFirst: Date | null = null
    for (let w = startWeek; w <= endWeek; w++) {
      const h = slot.finalAllocByWeek[w]
      if (h && h > 0) {
        finalH += h
        const d = slot.firstFinalDayByWeek[w]
        if (d && (!finalFirst || d.getTime() < finalFirst.getTime())) finalFirst = d
      }
    }
    if (finalH > 0) {
      rows.push({
        kind:      'final',
        siteId:    pid,
        hours:     finalH,
        sortKey:   finalFirst ? finalFirst.getTime() : sprintStart.getTime(),
        phaseRank: 2,
        priority,
      })
      sprintAlloc.set(pid, (sprintAlloc.get(pid) ?? 0) + finalH)
      sprintHours += finalH
    }

    // Review window overlap.
    if (slot.reviewStart && slot.reviewEnd) {
      const overlapStart = Math.max(slot.reviewStart.getTime(), sprintStart.getTime())
      const overlapEnd   = Math.min(slot.reviewEnd.getTime(),   sprintEndExcl.getTime())
      if (overlapEnd > overlapStart) {
        rows.push({
          kind:        'review',
          siteId:      pid,
          reviewStart: slot.reviewStart,
          reviewEnd:   slot.reviewEnd,
          sortKey:     overlapStart,
          phaseRank:   1,
          priority,
        })
      }
    }
  }

  // Per-week capacity sum (cap for the sprint). Per-church help that
  // was distributed to this week stacks on top of the org-wide
  // help_hours (sum of slot.helpHoursByWeek[w] across all sites).
  for (let i = startWeek; i <= endWeek; i++) {
    const wk = weekStart(i, cfg)
    const iso = fmtISO(wk)
    const adj = adjByIso.get(iso) ?? null
    let perChurchHelp = 0
    const perChurchHelpBySite: Array<{ siteId: string; hours: number }> = []
    for (const [pid, slot] of Object.entries(schedule)) {
      const h = slot.helpHoursByWeek?.[i] ?? 0
      if (h > 0) {
        perChurchHelp += h
        perChurchHelpBySite.push({ siteId: pid, hours: h })
      }
    }
    const base = adj?.base_capacity != null ? adj.base_capacity : cfg.base_weekly_cap
    const orgHelp = adj?.designer_out ? 0 : (adj?.help_hours ?? 0)
    const cap = adj?.is_blackout
      ? 0
      : Math.max(0, base + orgHelp + perChurchHelp)
    let hrs = 0
    for (const [pid, slot] of Object.entries(schedule)) {
      void pid
      hrs += (slot.buildAllocByWeek[i] ?? 0) + (slot.finalAllocByWeek[i] ?? 0)
    }
    weeks.push({ idx: i, iso, cap, hours: hrs, adj, perChurchHelp, perChurchHelpBySite })
    sprintCap += cap
  }

  // Sort rows: by first-day-in-window asc, then build < review < final,
  // then priority asc (high-pri first when same day + same phase).
  rows.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey
    if (a.phaseRank !== b.phaseRank) return a.phaseRank - b.phaseRank
    return a.priority - b.priority
  })

  const sprintAllocsArr = Array.from(sprintAlloc.entries()).map(([id, h]) => ({ id, hours: h }))
  const isFull = sprintCap > 0 && sprintHours >= sprintCap

  return (
    <div className="rounded-xl border border-lavender bg-cream/30">
      <div className="px-4 pt-3 pb-2">
        <p className="font-serif text-[16px] font-semibold text-deep-plum leading-tight">
          {sprintStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
          {' – '}
          {sprintEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
        </p>
        <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray mt-0.5">
          Sprint {sprintIdx + 1}
        </p>
      </div>

      {/* Capacity bar — dev hours only (build + final). */}
      <div className="px-4">
        <div className="h-2 w-full rounded bg-lavender-tint overflow-hidden flex">
          {sprintAllocsArr.map(a => (
            <div
              key={a.id}
              style={{
                width: `${sprintCap > 0 ? (a.hours / sprintCap) * 100 : 0}%`,
                background: colorByProject[a.id] ?? '#A89BE5',
              }}
              title={`${projectName(a.id)} · ${roundH(a.hours)}h`}
            />
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-purple-gray">
          <span className={isFull ? 'text-red-700 font-semibold' : ''}>
            {roundH(sprintHours)} dev hrs scheduled
          </span>
          <span>{sprintCap || 0} hr capacity</span>
        </div>
      </div>

      {/* Phase rows */}
      {rows.length > 0 && (
        <div className="px-4 pt-3 pb-2 space-y-1.5">
          {rows.map((r, i) => (
            <PhaseRowItem
              key={`${r.kind}-${r.siteId}-${i}`}
              row={r}
              color={colorByProject[r.siteId] ?? '#A89BE5'}
              name={projectName(r.siteId)}
            />
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
            perChurchHelp={w.perChurchHelp}
            perChurchHelpBySite={w.perChurchHelpBySite}
            projectName={projectName}
            onAdjust={onAdjust}
          />
        ))}
      </div>
    </div>
  )
}

function PhaseRowItem({
  row, color, name,
}: { row: PhaseRow; color: string; name: string }) {
  if (row.kind === 'review') {
    return (
      <div className="flex items-start gap-2.5 text-[13px]">
        <span
          className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1 border border-dashed"
          style={{ borderColor: color, background: 'transparent' }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-deep-plum">{name}</div>
          <div className="inline-flex items-center gap-1.5 mt-0.5">
            <PhasePill kind="review" />
            <span className="text-[11px] text-purple-gray">
              out {fmtShort(row.reviewStart!)} – {fmtShort(row.reviewEnd!)}
            </span>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2.5 text-[13px]">
      <span
        className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1"
        style={{ background: color }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-deep-plum">{name}</div>
        <div className="mt-0.5">
          <PhasePill kind={row.kind} />
        </div>
      </div>
      <span className="font-mono font-bold text-deep-plum shrink-0 mt-1">
        {roundH(row.hours ?? 0)}h
      </span>
    </div>
  )
}

function PhasePill({ kind }: { kind: 'build' | 'review' | 'final' }) {
  if (kind === 'build') {
    return (
      <span className="inline-block text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-lavender text-deep-plum">
        Build
      </span>
    )
  }
  if (kind === 'review') {
    return (
      <span className="inline-block text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
        Partner review
      </span>
    )
  }
  return (
    <span className="inline-block text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
      Final edits + launch
    </span>
  )
}

function roundH(n: number): number | string {
  // 0.5h granularity reads cleaner than 0.1h in the sprint cards.
  const r = Math.round(n * 2) / 2
  return r === Math.floor(r) ? r : r.toFixed(1)
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function weekIdxOf(d: Date, cfg: SchedulerConfig): number {
  const anchor = weekStart(0, cfg)
  return Math.floor((d.getTime() - anchor.getTime()) / (7 * DAY_MS))
}

// ── Per-week controls ────────────────────────────────────────────

function WeekControl({
  iso, sprintStart, adj, baseCap, scheduledHours,
  perChurchHelp, perChurchHelpBySite, projectName, onAdjust,
}: {
  iso:                    string
  sprintStart:            Date
  adj:                    WeekAdjustment | null
  baseCap:                number
  scheduledHours:         number
  perChurchHelp:          number
  perChurchHelpBySite:    Array<{ siteId: string; hours: number }>
  projectName:            (id: string) => string
  onAdjust:               (a: WeekAdjustment) => Promise<void>
}) {
  const [helpDraft, setHelpDraft] = useState(String(adj?.help_hours ?? ''))
  useEffect(() => { setHelpDraft(String(adj?.help_hours ?? '')) }, [adj?.help_hours])
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
    <div className={`flex items-center justify-between gap-2 flex-wrap text-[10.5px] ${blackout ? 'opacity-50' : ''}`}>
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
        <span className="font-mono text-purple-gray min-w-[40px] text-right">{roundH(scheduledHours)}h</span>
      </div>
      {perChurchHelp > 0 && (
        <div className="basis-full text-[10px] text-emerald-700 italic pl-12"
             title="Designer help hours auto-distributed from a church's Help hrs setting. These travel with the church if priority shifts.">
          + {roundH(perChurchHelp)}h help from{' '}
          {perChurchHelpBySite
            .sort((a, b) => b.hours - a.hours)
            .map(s => `${projectName(s.siteId)} (${roundH(s.hours)}h)`)
            .join(', ')}
        </div>
      )}
    </div>
  )
}
