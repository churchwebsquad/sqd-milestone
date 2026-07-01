/**
 * Build queue table — the primary editing surface on /web.
 *
 * Column order: Partner → Projected (highlighted) → Target → Δ →
 * Design due → Dev starts (with Sprint sub-label) → Dev hrs → Help hrs.
 * Every numeric/date cell is inline-editable; drag-reorder writes
 * priority_order.
 *
 * Behind-target rows render an inline read-only RECOVERY row beneath
 * the main row. The amber recoverable callout tells the AM how many
 * help hours land the church back on target — they enter that number
 * in the Help hrs column themselves.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Download, ExternalLink, Flag, GripVertical } from 'lucide-react'
import {
  weekStart,
  type SchedulerSite, type SchedulerConfig, type SiteSchedule,
} from '../../lib/launchScheduler'
import type { RecoveryResult } from '../../lib/launchRecoverySolver'
import type { ProjectLaunchRow } from '../../hooks/useLaunchPlan'
import { downloadQueueCsv } from '../../lib/queueCsvExport'

interface Props {
  rows:        ProjectLaunchRow[]
  sites:       SchedulerSite[]
  schedule:    Record<string, SiteSchedule>
  recovery:    Record<string, RecoveryResult>
  cfg:         SchedulerConfig
  onReorder:   (orderedIds: string[]) => Promise<void>
  onPatch:     (id: string, patch: Partial<ProjectLaunchRow>) => Promise<void>
  /** Navigation to the per-project workspace at ?tab=planning. */
  onSelect:    (id: string) => void
}

export function QueueTable({
  rows, sites, schedule, recovery, cfg, onReorder, onPatch, onSelect,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null)

  // Status lookup so we can split rows into queue / paused / blocked
  // / launched. Paused and blocked come from useLaunchPlan's scheduler
  // mapping (manual_sub_status takes precedence over phase).
  const siteById = new Map(sites.map(s => [s.id, s]))
  const isPausedRow  = (id: string) => siteById.get(id)?.status === 'paused'
  const isBlockedRow = (id: string) => siteById.get(id)?.status === 'blocked'

  // Main queue = active + waiting_feedback. Paused / blocked / launched
  // are peeled off into their own collapsed groups below — they don't
  // carry priority numbers since they don't consume queue capacity.
  // Uses effective_phase so a project manually marked launched via the
  // step-timeline override lands in the Launched group + drops out of
  // the active queue, even if current_phase hasn't been written back.
  const visible = [...rows]
    .filter(r =>
      r.effective_phase !== 'launched'
      && !r.archived
      && !isPausedRow(r.id)
      && !isBlockedRow(r.id),
    )
    .sort((a, b) => (a.priority_order ?? 99_999) - (b.priority_order ?? 99_999))

  const paused   = rows.filter(r => !r.archived && isPausedRow(r.id))
  const blocked  = rows.filter(r => !r.archived && isBlockedRow(r.id))
  const launched = rows.filter(r => r.effective_phase === 'launched' && !r.archived)

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
      <div className="px-4 py-3 border-b border-lavender bg-lavender-tint/30 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">Build queue</p>
          <p className="text-sm text-purple-gray mt-0.5">
            Drag to reorder priority. Dev runs top-to-bottom at <strong className="text-deep-plum">{cfg.base_weekly_cap} hrs/wk</strong>.
            Behind-target rows show whether help can recover the date — or whether the date stands.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadQueueCsv({ rows, sites, schedule })}
          className="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-lavender bg-white text-[11px] font-semibold text-deep-plum px-3 py-1.5 hover:border-primary-purple hover:text-primary-purple transition-colors"
          title="Download every row (active, paused, blocked, launched) with all visible columns as a CSV."
        >
          <Download size={12} />
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-left">
              <Th w="24px"></Th>
              <Th w="32px">#</Th>
              <Th>Partner</Th>
              <ThHighlight>Projected</ThHighlight>
              <Th>Target</Th>
              <Th>Δ</Th>
              <Th>Design due</Th>
              <Th>Dev starts</Th>
              <Th>Dev hrs</Th>
              <Th>Help hrs</Th>
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
                  onSelect={onSelect}
                />
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-6 text-center text-sm text-purple-gray italic">No active projects.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {paused.length > 0 && (
        <details className="border-t border-lavender" open>
          <summary className="px-4 py-2 text-[11px] uppercase tracking-widest font-bold text-amber-700 cursor-pointer hover:bg-amber-50/40">
            Paused ({paused.length})
          </summary>
          <ul className="px-4 py-2 space-y-1">
            {paused.map(p => (
              <li key={p.id} className="flex items-center gap-2 text-[12.5px]">
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="text-deep-plum hover:text-primary-purple font-semibold"
                >
                  {p.church_name ?? p.name}
                </button>
                <span className="text-[10px] font-mono text-purple-gray">#{p.member}</span>
                {p.status_reason && (
                  <span className="text-[11px] text-purple-gray italic truncate" title={p.status_reason}>
                    — {p.status_reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {blocked.length > 0 && (
        <details className="border-t border-lavender" open>
          <summary className="px-4 py-2 text-[11px] uppercase tracking-widest font-bold text-red-700 cursor-pointer hover:bg-red-50/40">
            Blocked ({blocked.length})
          </summary>
          <ul className="px-4 py-2 space-y-1">
            {blocked.map(p => (
              <li key={p.id} className="flex items-center gap-2 text-[12.5px]">
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="text-deep-plum hover:text-primary-purple font-semibold"
                >
                  {p.church_name ?? p.name}
                </button>
                <span className="text-[10px] font-mono text-purple-gray">#{p.member}</span>
                {p.status_reason && (
                  <span className="text-[11px] text-purple-gray italic truncate" title={p.status_reason}>
                    — {p.status_reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

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
  draggingMe, onDragStart, onDragOver, onDrop, onPatch, onSelect,
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
  onSelect:   (id: string) => void
}) {
  const isLate   = slot?.delta != null && slot.delta < 0
  const isPaused = site?.status === 'paused'
  // Projected launch — for waiting_feedback projects the day-level
  // scheduler now actually allocates the final pass, so slot.launchDate
  // should be present. Paused sites have no slot → no projected date.
  const projectedDate: Date | null = isPaused
    ? null
    : (slot?.launchDate ?? (isWaiting && row.launch_date ? new Date(`${row.launch_date}T00:00:00Z`) : null))
  const launchedISO = projectedDate ? projectedDate.toISOString().slice(0, 10) : null
  const devStartISO = slot?.devStartDate ? slot.devStartDate.toISOString().slice(0, 10) : null
  const hardDeadlineMissed = row.hard_deadline && launchedISO && launchedISO > row.hard_deadline
  const sprintSpan = !isPaused && slot
    ? sprintLabel(slot.startWeek, slot.endWeek, cfg)
    : null

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
        onDragStart={e => {
          // Only drag from row chrome (grip cell, name cell, etc.).
          // Inputs / selects / buttons should remain clickable without
          // the row hijacking the click into a drag-start.
          const target = e.target as HTMLElement
          if (target.closest('input, select, textarea, button, a, label')) {
            e.preventDefault()
            return
          }
          onDragStart()
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={[
          'border-t border-lavender/60',
          draggingMe ? 'opacity-40' : '',
          isLate ? 'bg-red-50/40' : 'hover:bg-lavender-tint/15',
        ].join(' ')}
      >
        <td className="px-2 py-2.5 align-top cursor-grab" title="Drag to reorder">
          <GripVertical size={14} className="text-purple-gray" />
        </td>
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
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-purple-gray flex-wrap">
            <span className="font-mono">#{row.member}</span>
            {row.current_phase && <><span>·</span><span className="uppercase tracking-wider text-[10px] font-bold text-primary-purple">{row.current_phase}</span></>}
            {isWaiting && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold uppercase">Waiting feedback</span>}
            {row.hard_deadline && (
              <span className={`ml-1 inline-flex items-center gap-0.5 ${hardDeadlineMissed ? 'text-red-700 font-bold' : 'text-amber-700'}`}>
                <Flag size={10} /> {row.hard_deadline.slice(5)}
              </span>
            )}
          </div>
          {row.activity_label && (
            <p className="text-[11px] text-deep-plum/75 mt-1 leading-snug" title={row.activity_label}>
              {row.activity_label}
            </p>
          )}
        </td>
        {/* Projected — highlighted column. */}
        <td className="px-2 py-2.5 align-top bg-primary-purple/5 border-l border-r border-primary-purple/15">
          {isPaused ? (
            <span className="text-[11px] text-purple-gray italic">paused</span>
          ) : launchedISO ? (
            <span className="text-[14px] font-semibold text-deep-plum">{shortDate(launchedISO)}</span>
          ) : (
            <span className="text-purple-gray">—</span>
          )}
        </td>
        <td className="px-2 py-2.5 align-top">
          <DateCell
            value={row.launch_date ?? null}
            onChange={iso => onPatch({ launch_date: iso })}
            placeholder="—"
          />
        </td>
        <td className="px-2 py-2.5 align-top">
          {!isPaused && slot?.delta != null && !isWaiting
            ? <DeltaPill delta={slot.delta} />
            : <span className="text-purple-gray">—</span>}
        </td>
        <td className="px-2 py-2.5 align-top whitespace-nowrap">
          {designDueISO && slot?.devStartDate ? (
            <div
              title={`Design needs to be wrapped by ${shortDate(designDueISO)} so the developer can pick up cleanly on ${shortDate(slot.devStartDate.toISOString().slice(0, 10))} (dev start − 2 business days).`}
              className="text-[13px] text-deep-plum"
            >
              {shortDate(designDueISO)}
            </div>
          ) : (
            <span className="text-purple-gray/40">—</span>
          )}
        </td>
        <td className="px-2 py-2.5 align-top whitespace-nowrap">
          {isPaused ? (
            <span className="text-[11px] text-purple-gray italic">paused</span>
          ) : devStartISO && !isWaiting ? (
            <div>
              <div className="text-[13px] text-deep-plum">{shortDate(devStartISO)}</div>
              {sprintSpan && (
                <div className="text-[10.5px] text-purple-gray/80 font-mono mt-0.5">{sprintSpan}</div>
              )}
            </div>
          ) : isWaiting ? (
            <span className="text-[11px] text-amber-700 italic">in final pass</span>
          ) : (
            <span className="text-purple-gray/40">—</span>
          )}
        </td>
        <td className="px-2 py-2.5 align-top">
          <NumberCell
            value={row.dev_hours_estimate ?? 60}
            onCommit={n => onPatch({
              dev_hours_estimate: n,
              dev_hours_source:   'manual',
            })}
            title={row.dev_hours_source === 'clickup'
              ? `From ClickUp sync · ${row.last_synced_at ? new Date(row.last_synced_at).toLocaleDateString() : ''}. Editing flips to manual.`
              : 'Manually entered.'}
          />
        </td>
        <td className="px-2 py-2.5 align-top">
          <NumberCell
            value={row.help_hours_needed ?? 0}
            onCommit={n => onPatch({ help_hours_needed: n })}
            title="Designer help hours allocated to this church. The scheduler distributes them across the weeks this church is being worked on, and they travel with the church if priority shifts."
          />
        </td>
        <td className="px-2 py-2.5 align-top">
          <Link to={`/web/${row.id}?tab=planning`} className="text-purple-gray hover:text-primary-purple" title="Open project planning tab">
            <ExternalLink size={12} />
          </Link>
        </td>
      </tr>
      {rec && rec.state !== 'on_time' && !isWaiting && !isPaused && (
        <tr>
          <td colSpan={10} className="px-2 pb-2">
            <RecoveryRow rec={rec} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Recovery inline row ──────────────────────────────────────────

function RecoveryRow({ rec }: { rec: RecoveryResult }) {
  if (rec.state === 'recoverable' && rec.helpHours) {
    return (
      <div className="ml-10 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
        <p className="text-[12.5px] text-amber-900">
          <strong>{rec.behind}d behind.</strong> Add{' '}
          <strong>{rec.helpHours} help hrs</strong> to this church to land on{' '}
          <strong>{shortDate(rec.date.toISOString().slice(0, 10))}</strong>. Drop it into the
          Help hrs column on the right.
        </p>
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
          <strong>{rec.behind}d behind.</strong> {reason} Projected launch{' '}
          <strong>{shortDate(rec.date.toISOString().slice(0, 10))}</strong> stands — renegotiate the
          target, reprioritize, or add a second developer.
        </p>
      </div>
    )
  }
  if (rec.state === 'insufficient' && rec.helpHours) {
    return (
      <div className="ml-10 rounded-md border border-red-300 bg-red-50 px-3 py-2">
        <p className="text-[12.5px] text-red-900">
          <strong>{rec.behind}d behind.</strong> Even {rec.helpHours} help hrs isn't enough —
          best achievable date is{' '}
          <strong>{shortDate(rec.date.toISOString().slice(0, 10))}</strong>{' '}
          ({rec.stillLate}d still late).
        </p>
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

/** Highlighted column header — used on the projected launch column so
 *  it visually anchors the row as the single most-important number. */
function ThHighlight({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-2 py-2 text-[11px] uppercase tracking-widest font-bold text-primary-purple border-b border-primary-purple/40 bg-primary-purple/5 border-l border-r border-primary-purple/15">
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

/** "Dev S1" / "Dev S4–S5" — the sub-label that appears under the
 *  Dev starts date so PMs can map a project to its sprint slot at
 *  a glance. */
function sprintLabel(startWeek: number, endWeek: number, cfg: SchedulerConfig): string {
  const s = Math.floor(startWeek / cfg.sprint_weeks) + 1
  const e = Math.floor(endWeek   / cfg.sprint_weeks) + 1
  return s === e ? `Dev S${s}` : `Dev S${s}–S${e}`
}

/** "Jan 6, 2026" — year is always shown. We previously omitted the
 *  year to keep cells compact, but that masked a real failure mode:
 *  projected launches a year past target (e.g. "Jan 27" rendering for
 *  a 2027 schedule when the partner targeted Jan 6 2026) looked
 *  identical to a near-term date. Always-show-year fixes the
 *  interpretation. */
function shortDate(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

/** Editable number cell with local-draft semantics. Avoids the bug
 *  where typing "30" into a "60"-default input persisted as 6030 (the
 *  characters were appended to the existing value because every
 *  keystroke wrote back to the parent state). Behavior:
 *   - Focus selects all so the next keystroke replaces the value.
 *   - Edits live in local state until blur or Enter, then commit.
 *   - When the parent prop changes externally (refetch), the draft
 *     resyncs unless the input is currently focused. */
function NumberCell({
  value, onCommit, title,
}: {
  value:    number
  onCommit: (n: number) => void
  title?:   string
}) {
  const [draft, setDraft] = useState<string>(String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    // Sync from the parent when the prop changes — but only when the
    // user isn't currently typing, so a slow refetch doesn't blow
    // away an in-flight edit.
    if (!focused) setDraft(String(value))
  }, [value, focused])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      onCommit(0)
      setDraft('0')
      return
    }
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) {
      // Reject garbage; restore prior value.
      setDraft(String(value))
      return
    }
    if (n !== value) onCommit(n)
  }

  return (
    <input
      type="number"
      min={0}
      step={1}
      value={draft}
      title={title}
      onChange={e => setDraft(e.target.value)}
      onFocus={e => { setFocused(true); e.currentTarget.select() }}
      onBlur={() => { setFocused(false); commit() }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(String(value)); (e.currentTarget as HTMLInputElement).blur() }
      }}
      className="w-16 text-[13px] font-mono text-right px-1.5 py-1 rounded border border-lavender bg-white focus:border-primary-purple focus:outline-none"
    />
  )
}

/** Editable date cell that DISPLAYS "Jun 23" (matching the projected
 *  launch's format) but EDITS via the browser's native date picker.
 *  The native `<input type=date>` is overlaid invisibly so a click
 *  anywhere on the cell opens the picker, regardless of where the
 *  user lands. Avoids the m/d/y vs Mon-Day mismatch between Target
 *  and Projected columns. */
/** Native date input, styled to fit the cell. We previously overlayed
 *  an invisible input with sr-only / opacity-0 and called showPicker(),
 *  but the picker positioned relative to a 1px input → often opened
 *  off-screen. Rendering a real visible input means the browser
 *  positions the picker reliably relative to the visible field. */
function DateCell({
  value, onChange,
}: {
  value:    string | null
  onChange: (iso: string | null) => void
  placeholder?: string  // kept for API compatibility, unused
}) {
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="text-[13px] font-mono text-deep-plum bg-white border border-lavender rounded px-2 py-1 hover:border-primary-purple/60 focus:border-primary-purple focus:outline-none cursor-pointer min-w-[130px]"
      title="Click to edit target launch"
    />
  )
}
