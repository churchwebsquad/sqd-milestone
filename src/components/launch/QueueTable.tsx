/**
 * Build queue table — the primary editing surface on /web.
 *
 * Ported from the prototype's queue table. Every value is editable:
 *   - drag handle to reorder (priority_order)
 *   - inline target date
 *   - inline dev hours (manual; flips dev_hours_source = 'manual')
 *   - recovery-mode chip toggle (designer ↔ dev-only)
 *   - hard-deadline flag
 *
 * Read-only signals:
 *   - projected launch + Δ pill
 *   - sprint span
 *   - tracked vs estimate progress bar + pace badge (when in_progress
 *     AND tracked_hours > 0)
 *
 * Behind-target rows render an inline RECOVERY row below them
 *   (amber w/ "Apply help" CTA when recoverable; gray "date stands"
 *   when locked / insufficient).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ExternalLink, Flag, GripVertical } from 'lucide-react'
import {
  calBtw, parseD, paceOf, weekStart,
  type SchedulerSite, type SchedulerConfig, type SiteSchedule,
} from '../../lib/launchScheduler'
import type { RecoveryResult } from '../../lib/launchRecoverySolver'
import type { ProjectLaunchRow } from '../../hooks/useLaunchPlan'

interface Props {
  rows:        ProjectLaunchRow[]
  sites:       SchedulerSite[]
  schedule:    Record<string, SiteSchedule>
  recovery:    Record<string, RecoveryResult>
  cfg:         SchedulerConfig
  onReorder:   (orderedIds: string[]) => Promise<void>
  onPatch:     (id: string, patch: Partial<ProjectLaunchRow>) => Promise<void>
  onApplyHelp: (perWeek: Record<number, number>) => Promise<void>
  /** Navigation to the per-project workspace at ?tab=planning. */
  onSelect:    (id: string) => void
}

export function QueueTable({
  rows, sites, schedule, recovery, cfg, onReorder, onPatch, onApplyHelp, onSelect,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null)

  // Build display rows = active + waiting_feedback (launched excluded
  // — they're shown in a collapsed group below). Order by priority_order
  // (nulls last).
  const visible = [...rows]
    .filter(r => r.current_phase !== 'launched' && !r.archived)
    .sort((a, b) => (a.priority_order ?? 99_999) - (b.priority_order ?? 99_999))

  const launched = rows.filter(r => r.current_phase === 'launched' && !r.archived)

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      return
    }
    // Renumber priority_order around the drop position.
    const ordered = visible.map(r => r.id)
    const fromIdx = ordered.indexOf(dragId)
    const toIdx   = ordered.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    const next = [...ordered]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    void onReorder(next)
    setDragId(null)
  }

  return (
    <div className="rounded-2xl border border-lavender bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-lavender bg-lavender-tint/30">
        <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">Build queue</p>
        <p className="text-sm text-purple-gray mt-0.5">
          Drag to reorder priority. Dev runs top-to-bottom at <strong className="text-deep-plum">{cfg.base_weekly_cap} hrs/wk</strong>.
          Behind-target rows show whether help can recover the date — or whether the date stands.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-left">
              <Th w="24px"></Th>
              <Th w="32px">#</Th>
              <Th>Partner</Th>
              <Th>Target</Th>
              <Th>Projected</Th>
              <Th>Δ</Th>
              <Th>Design due</Th>
              <Th>Tracked vs est.</Th>
              <Th>Dev hrs</Th>
              <Th>Recovery</Th>
              <Th>Dev sprint</Th>
              <Th w="32px"></Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, idx) => {
              const site = sites.find(s => s.id === row.id)
              const slot = schedule[row.id]
              const rec  = recovery[row.id]
              const isWaiting = site?.status === 'waiting_feedback'
              return (
                <RowAndRecovery
                  key={row.id}
                  row={row}
                  site={site}
                  slot={slot}
                  rec={rec}
                  priority={idx + 1}
                  cfg={cfg}
                  isWaiting={isWaiting}
                  draggingMe={dragId === row.id}
                  onDragStart={() => setDragId(row.id)}
                  onDragOver={ev => ev.preventDefault()}
                  onDrop={() => handleDrop(row.id)}
                  onPatch={(patch) => void onPatch(row.id, patch)}
                  onApplyHelp={onApplyHelp}
                  onSelect={onSelect}
                />
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-6 text-center text-sm text-purple-gray italic">No active projects.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {launched.length > 0 && (
        <details className="border-t border-lavender">
          <summary className="px-4 py-2 text-[11px] uppercase tracking-widest font-bold text-purple-gray cursor-pointer hover:bg-lavender-tint/20">
            Launched ({launched.length})
          </summary>
          <ul className="px-4 py-2 space-y-0.5">
            {launched.map(p => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="text-[12px] text-purple-gray hover:text-deep-plum"
                >
                  {p.church_name ?? p.name} <span className="text-[10px] font-mono">#{p.member}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// ── Row + inline recovery ────────────────────────────────────────

function RowAndRecovery({
  row, site, slot, rec, priority, cfg, isWaiting,
  draggingMe, onDragStart, onDragOver, onDrop, onPatch, onApplyHelp, onSelect,
}: {
  row:        ProjectLaunchRow
  site:       SchedulerSite | undefined
  slot:       SiteSchedule | undefined
  rec:        RecoveryResult | undefined
  priority:   number
  cfg:        SchedulerConfig
  isWaiting:  boolean
  draggingMe: boolean
  onDragStart:() => void
  onDragOver: (ev: React.DragEvent) => void
  onDrop:     () => void
  onPatch:    (patch: Partial<ProjectLaunchRow>) => void
  onApplyHelp:(perWeek: Record<number, number>) => Promise<void>
  onSelect:   (id: string) => void
}) {
  const isLate = slot?.delta != null && slot.delta < 0
  const pace   = site ? paceOf(site) : null
  // Projected launch — for waiting_feedback projects the scheduler
  // doesn't allocate hours (dev is done), so fall back to the AM's
  // target launch as the projected date. That's the date the partner
  // is sitting on while review wraps up.
  const projectedDate: Date | null =
    slot?.launchDate ?? (isWaiting && row.launch_date ? new Date(`${row.launch_date}T00:00:00Z`) : null)
  const launchedISO = projectedDate ? projectedDate.toISOString().slice(0, 10) : null
  const span = slot
    ? sprintLabel(slot.startWeek, slot.endWeek, cfg)
    : '—'
  const spanDates = slot
    ? sprintDateRange(slot.startWeek, slot.endWeek, cfg)
    : null
  const hardDeadlineMissed = row.hard_deadline && launchedISO && launchedISO > row.hard_deadline

  // Upstream design cut-off: dev start − 2 business days, so the
  // designer has a clear handoff target with a 1-business-day buffer
  // before dev picks the project up. Suppressed for projects that
  // aren't actively in the queue (done with dev / waiting feedback).
  // slot.devStartDate is a Date object (per SiteSchedule); convert
  // to ISO for the business-day math.
  const designDueISO = !isWaiting && slot?.devStartDate
    ? subBizDays(slot.devStartDate.toISOString().slice(0, 10), 2)
    : null

  return (
    <>
      <tr
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={[
          'border-t border-lavender/60',
          draggingMe ? 'opacity-40' : '',
          isLate ? 'bg-red-50/40' : 'hover:bg-lavender-tint/15',
          'cursor-grab',
        ].join(' ')}
      >
        <td className="px-2 py-2.5 align-top"><GripVertical size={14} className="text-purple-gray" /></td>
        <td className="px-2 py-2.5 align-top font-mono text-[12px] text-purple-gray">{priority}</td>
        <td className="px-2 py-2.5 align-top min-w-[200px]">
          <button
            type="button"
            onClick={() => onSelect(row.id)}
            className="text-left text-[14px] font-semibold text-deep-plum hover:text-primary-purple inline-flex items-center gap-1"
          >
            {row.church_name ?? row.name}
            <ArrowRight size={11} className="opacity-50" />
          </button>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-purple-gray">
            <span className="font-mono">#{row.member}</span>
            {row.current_phase && <><span>·</span><span>{row.current_phase}</span></>}
            {isWaiting && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold uppercase">Waiting feedback</span>}
            {row.hard_deadline && (
              <span className={`ml-1 inline-flex items-center gap-0.5 ${hardDeadlineMissed ? 'text-red-700 font-bold' : 'text-amber-700'}`}>
                <Flag size={10} /> {row.hard_deadline.slice(5)}
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-2.5 align-top">
          <DateCell
            value={row.launch_date ?? null}
            onChange={iso => onPatch({ launch_date: iso })}
            placeholder="—"
          />
        </td>
        <td className="px-2 py-2.5 align-top text-[13px] text-deep-plum">
          {launchedISO ? shortDate(launchedISO) : '—'}
        </td>
        <td className="px-2 py-2.5 align-top">
          {slot?.delta != null && !isWaiting ? <DeltaPill delta={slot.delta} /> : <span className="text-purple-gray">—</span>}
        </td>
        <td className="px-2 py-2.5 align-top text-[13px] text-purple-gray">
          {designDueISO ? (
            <span
              title="Design needs to be wrapped by this date so the developer can pick the project up cleanly (dev start − 2 business days)."
            >
              {shortDate(designDueISO)}
            </span>
          ) : (
            <span className="text-purple-gray/40">—</span>
          )}
        </td>
        <td className="px-2 py-2.5 align-top min-w-[150px]">
          {pace ? <PaceCell pace={pace} planned={site!.planned_dev_hours} tracked={site!.tracked_hours} /> : <span className="text-purple-gray italic text-[12px]">—</span>}
        </td>
        <td className="px-2 py-2.5 align-top">
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step={1}
              value={row.dev_hours_estimate ?? 60}
              onChange={e => onPatch({ dev_hours_estimate: e.target.value === '' ? null : Number(e.target.value), dev_hours_source: 'manual' })}
              className="w-16 text-[13px] font-mono text-right px-1.5 py-1 rounded border border-transparent hover:border-lavender focus:border-primary-purple focus:outline-none bg-transparent"
            />
            <span className="text-[10px] text-purple-gray">h</span>
            <span
              className={`text-[10px] font-bold uppercase tracking-widest ${row.dev_hours_source === 'clickup' ? 'text-emerald-700' : 'text-purple-gray'}`}
              title={row.dev_hours_source === 'clickup'
                ? `From ClickUp sync · ${row.last_synced_at ? new Date(row.last_synced_at).toLocaleDateString() : ''}`
                : 'Manually entered'}
            >
              {row.dev_hours_source === 'clickup' ? '●' : '○'}
            </span>
          </div>
        </td>
        <td className="px-2 py-2.5 align-top">
          <button
            type="button"
            onClick={() => onPatch({ recovery_mode: row.recovery_mode === 'designer' ? 'dev-only' : 'designer' })}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${row.recovery_mode === 'designer' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-purple-gray/30 bg-cream text-purple-gray'}`}
            title={row.recovery_mode === 'designer'
              ? 'Help can be offloaded to the designer. Click → dev-only.'
              : 'Work is developer-only — can\'t offload. Click → designer.'}
          >
            {row.recovery_mode === 'designer' ? '🎨 designer' : '🔒 dev-only'}
          </button>
        </td>
        <td className="px-2 py-2.5 align-top text-purple-gray whitespace-nowrap">
          <div className="font-mono text-[12px]">{span}</div>
          {spanDates && (
            <div className="text-[11px] text-purple-gray/80">{spanDates}</div>
          )}
        </td>
        <td className="px-2 py-2.5 align-top">
          <Link to={`/web/${row.id}?tab=planning`} className="text-purple-gray hover:text-primary-purple" title="Open project planning tab">
            <ExternalLink size={12} />
          </Link>
        </td>
      </tr>
      {rec && rec.state !== 'on_time' && !isWaiting && (
        <tr>
          <td colSpan={11} className="px-2 pb-2">
            <RecoveryRow rec={rec} cfg={cfg} onApplyHelp={onApplyHelp} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Recovery inline row ──────────────────────────────────────────

function RecoveryRow({
  rec, cfg, onApplyHelp,
}: { rec: RecoveryResult; cfg: SchedulerConfig; onApplyHelp: (perWeek: Record<number, number>) => Promise<void> }) {
  if (rec.state === 'recoverable' && rec.perWeek && rec.helpHours) {
    const weeks = Object.entries(rec.perWeek)
      .map(([idx, h]) => ({ idx: Number(idx), h }))
      .sort((a, b) => a.idx - b.idx)
      .map(w => `wk ${shortDate(weekStart(w.idx, cfg).toISOString().slice(0, 10))}: +${w.h}h`)
    return (
      <div className="ml-10 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start justify-between gap-2">
        <p className="text-[12.5px] text-amber-900">
          <strong>{rec.behind}d behind.</strong> Recoverable: add{' '}
          <strong>{rec.helpHours} help hrs</strong> (≈{(rec.helpHours / 7).toFixed(1)} designer-days) in {weeks.join(' · ')} →
          launches <strong>{shortDate(rec.date.toISOString().slice(0, 10))}</strong>, within target.
        </p>
        <button
          type="button"
          onClick={() => void onApplyHelp(rec.perWeek ?? {})}
          className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-deep-plum text-white text-[11px] font-semibold hover:bg-primary-purple"
        >
          Apply help
        </button>
      </div>
    )
  }
  if (rec.state === 'locked') {
    const reason = rec.reason === 'dev-only'
      ? 'Work is developer-only — can\'t offload.'
      : 'Designer unavailable in the weeks that feed this site.'
    return (
      <div className="ml-10 rounded-md border border-purple-gray/30 bg-cream px-3 py-2">
        <p className="text-[12.5px] text-purple-gray">
          <strong>{rec.behind}d behind.</strong> {reason}{' '}
          Projected launch <strong>{shortDate(rec.date.toISOString().slice(0, 10))}</strong> stands —
          renegotiate the target, reprioritize, or add a second developer.
        </p>
      </div>
    )
  }
  if (rec.state === 'insufficient' && rec.perWeek && rec.helpHours) {
    return (
      <div className="ml-10 rounded-md border border-red-300 bg-red-50 px-3 py-2 flex items-start justify-between gap-2">
        <p className="text-[12.5px] text-red-900">
          <strong>{rec.behind}d behind.</strong> Even {rec.helpHours} help hrs ({(rec.helpHours / 7).toFixed(1)} designer-days)
          isn't enough — best achievable date is <strong>{shortDate(rec.date.toISOString().slice(0, 10))}</strong>
          ({rec.stillLate}d still late).
        </p>
        <button
          type="button"
          onClick={() => void onApplyHelp(rec.perWeek ?? {})}
          className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-red-400 text-red-800 text-[11px] font-semibold hover:bg-red-100"
        >
          Apply best-effort help
        </button>
      </div>
    )
  }
  return null
}

// ── Helpers ──────────────────────────────────────────────────────

function Th({ children, w }: { children?: React.ReactNode; w?: string }) {
  return (
    <th style={w ? { width: w } : undefined} className="px-2 py-2 text-[11px] uppercase tracking-widest font-bold text-purple-gray border-b border-lavender">
      {children}
    </th>
  )
}

function DeltaPill({ delta }: { delta: number }) {
  const tone = delta < 0 ? 'bg-red-100 text-red-800'
            : delta <= 7 ? 'bg-amber-100 text-amber-800'
            : 'bg-emerald-100 text-emerald-800'
  const text = delta < 0 ? `−${Math.abs(delta)}d` : `+${delta}d`
  return <span className={`inline-block text-[11.5px] font-bold px-2 py-0.5 rounded-full ${tone}`}>{text}</span>
}

function PaceCell({ pace, planned, tracked }: { pace: ReturnType<typeof paceOf> extends null | infer R ? R : never; planned: number; tracked: number }) {
  if (!pace) return null
  const tone = pace.cls === 'late' ? 'bg-red-500'
            : pace.cls === 'tight' ? 'bg-amber-500'
            : 'bg-emerald-500'
  return (
    <div>
      <div className="h-1.5 w-full rounded bg-lavender-tint overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pace.pct)}%` }} />
      </div>
      <p className="text-[11px] font-mono text-purple-gray mt-0.5">
        {pace.pct}% · {tracked}/{planned}h ·{' '}
        <span className={pace.cls === 'late' ? 'text-red-700 font-bold' : pace.cls === 'tight' ? 'text-amber-700' : 'text-emerald-700'}>
          {pace.over > 0 ? `+${pace.over} over` : pace.over < 0 ? `${pace.over} under` : 'on est.'}
        </span>
      </p>
    </div>
  )
}

function sprintLabel(startWeek: number, endWeek: number, cfg: SchedulerConfig): string {
  // Spec convention: S1 = weeks 0..1, S2 = weeks 2..3, etc.
  // Dev-prefixed per Ashley — the queue table only sequences dev sprints.
  const s = Math.floor(startWeek / cfg.sprint_weeks) + 1
  const e = Math.floor(endWeek   / cfg.sprint_weeks) + 1
  return s === e ? `Dev S${s}` : `Dev S${s}–S${e}`
}

/** Calendar-date range matching the sprint span (start of first sprint
 *  to end of last sprint). Used to surface "Dev S4–S5, Aug 1–21" so
 *  the PM doesn't have to mentally map sprint numbers to dates. */
function sprintDateRange(startWeek: number, endWeek: number, cfg: SchedulerConfig): string {
  const firstSprintIdx = Math.floor(startWeek / cfg.sprint_weeks)
  const lastSprintIdx  = Math.floor(endWeek   / cfg.sprint_weeks)
  const start = weekStart(firstSprintIdx * cfg.sprint_weeks, cfg)
  const lastSprintStart = weekStart(lastSprintIdx * cfg.sprint_weeks, cfg)
  const end = new Date(lastSprintStart.getTime() + (cfg.sprint_weeks * 7 - 1) * 86_400_000)
  return `${shortDate(start.toISOString().slice(0, 10))}–${shortDate(end.toISOString().slice(0, 10))}`
}

function shortDate(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return iso }
}

/** Subtract N business days (skipping Sat/Sun) from an ISO yyyy-mm-dd
 *  date. Returns ISO. Used to compute the upstream design cut-off
 *  from the dev start date. */
function subBizDays(iso: string, n: number): string {
  let d = new Date(`${iso}T00:00:00Z`)
  let left = Math.max(0, Math.round(n))
  while (left > 0) {
    d = new Date(d.getTime() - 86_400_000)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d.toISOString().slice(0, 10)
}

/** Editable date cell that DISPLAYS "Jun 23" (matching the projected
 *  launch's format) but EDITS via the browser's native date picker.
 *  The native `<input type=date>` is overlaid invisibly so a click
 *  anywhere on the cell opens the picker, regardless of where the
 *  user lands. Avoids the m/d/y vs Mon-Day mismatch between Target
 *  and Projected columns. */
function DateCell({
  value, onChange, placeholder = '—',
}: {
  value:       string | null
  onChange:    (iso: string | null) => void
  placeholder?: string
}) {
  return (
    <div className="relative inline-block min-w-[72px]">
      <span className={`block text-[13px] ${value ? 'text-deep-plum' : 'text-purple-gray italic'}`}>
        {value ? shortDate(value) : placeholder}
      </span>
      <input
        type="date"
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        title="Click to edit"
      />
    </div>
  )
}
