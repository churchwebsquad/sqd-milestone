/**
 * Manager-level list view — the new default at /web.
 *
 * Each row carries:
 *   - a drag handle (always live — reorder is the primary way to
 *     change priority; the manual number field is gone)
 *   - project name + member + phase
 *   - "Where it is" — the consolidator's one-liner (step name + progress)
 *   - status pill with WHY in title
 *   - launch date — inline editable date input + days-to-launch hint
 *     + predicted launch chip when target is null
 *   - chevron to open the planning tab
 */
import { useMemo, useState } from 'react'
import { ChevronRight, GripVertical, Search } from 'lucide-react'
import { WMStatusPill } from '../StatusPill'
import type { CurrentActivity } from '../../../lib/webCurrentActivity'
import { detectStall, type StallSignal } from '../../../lib/webStallDetector'
import { fromIsoDate, daysBetween } from '../../../lib/dateRange'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'
import type { ProjectSubStatus, WebProjectPhase, ManualSubStatus } from '../../../types/database'

interface Props {
  rows:      ProjectRowVM[]
  loading:   boolean
  onSelect:  (projectId: string) => void
  /** Fires when the user drags a row to a new position. */
  onPriorityChange?: (projectId: string, newOrder: number) => void
  /** Fires when the user types into the launch date cell. */
  onLaunchDateChange?: (projectId: string, iso: string | null) => Promise<void> | void
  /** Group rows by phase / AM / launch month. 'none' = priority order. */
  groupBy?: 'none' | 'phase' | 'owner' | 'month'
  /** Sort within each group. */
  sortBy?:  'priority' | 'launch_date' | 'days_behind' | 'name'
  query?:   string
}

const PHASE_LABEL: Record<WebProjectPhase, string> = {
  intake: 'Intake', content: 'Content', design: 'Design',
  dev: 'Dev', review: 'Final review', launched: 'Launched',
}
const PHASE_ORDER_LIST: WebProjectPhase[] = ['intake', 'content', 'design', 'dev', 'review', 'launched']
const SUB_TONE: Record<ProjectSubStatus, Parameters<typeof WMStatusPill>[0]['tone']> = {
  on_track: 'success', ahead: 'turquoise', off_track: 'warning',
  blocked: 'danger', complete: 'neutral',
}
const SUB_LABEL: Record<ProjectSubStatus, string> = {
  on_track: 'On track', ahead: 'Ahead', off_track: 'Off track',
  blocked: 'Blocked', complete: 'Complete',
}
const MANUAL_LABEL: Record<ManualSubStatus, string> = {
  in_progress: 'In progress', waiting_partner: 'Waiting partner',
  blocked: 'Blocked', paused: 'Paused',
}
const MANUAL_TONE: Record<ManualSubStatus, Parameters<typeof WMStatusPill>[0]['tone']> = {
  in_progress: 'success', waiting_partner: 'warning',
  blocked: 'danger', paused: 'neutral',
}

interface EnrichedRow {
  row:      ProjectRowVM
  activity: CurrentActivity
  stall:    StallSignal
  daysToLaunch: number | null
}

export function ListView({
  rows, loading, onSelect, onPriorityChange, onLaunchDateChange,
  groupBy = 'none', sortBy = 'priority', query = '',
}: Props) {
  const today = new Date()
  const [dragId, setDragId] = useState<string | null>(null)

  const enriched: EnrichedRow[] = useMemo(() => {
    return rows.map(r => {
      const activity = r.activity   // memoized once by the hook
      const stall = detectStall({ project: r, activity, today })
      const launch = r.launch_date ? fromIsoDate(r.launch_date.slice(0, 10)) : null
      const dtl = launch ? daysBetween(today, launch) : null
      return { row: r, activity, stall, daysToLaunch: dtl }
    })
  }, [rows, today])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return enriched
    return enriched.filter(e => {
      const name = (e.row.church_name ?? e.row.name ?? '').toLowerCase()
      const member = String(e.row.member ?? '').toLowerCase()
      return name.includes(q) || member.includes(q)
    })
  }, [enriched, query])

  const sorted = useMemo(() => {
    const list = [...filtered]
    list.sort((a, b) => {
      switch (sortBy) {
        case 'launch_date':
          return (a.row.launch_date ?? '~').localeCompare(b.row.launch_date ?? '~')
        case 'days_behind':
          return (a.row.health.targetGapDays ?? 0) - (b.row.health.targetGapDays ?? 0)
        case 'name':
          return (a.row.church_name ?? a.row.name).localeCompare(b.row.church_name ?? b.row.name)
        case 'priority':
        default:
          return (a.row.priority_order ?? 999) - (b.row.priority_order ?? 999)
      }
    })
    return list
  }, [filtered, sortBy])

  const groups = useMemo(() => groupRows(sorted, groupBy), [sorted, groupBy])

  if (loading) {
    return (
      <div className="space-y-1">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="h-14 bg-wm-bg-hover rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-8 text-center">
        <Search size={20} className="mx-auto text-wm-text-subtle mb-2" />
        <p className="text-[12px] text-wm-text-muted">
          {query ? `No projects match "${query}".` : 'No projects yet.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map(g => (
        <div key={g.label} className="rounded-lg border border-wm-border bg-wm-bg overflow-hidden">
          {g.label !== '__all__' && (
            <div className="px-3 py-2 bg-wm-bg-elevated border-b border-wm-border flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text">{g.label}</p>
              <p className="text-[10.5px] font-mono text-wm-text-subtle">{g.items.length}</p>
            </div>
          )}
          <ul className="divide-y divide-wm-border">
            {g.items.map(e => (
              <ListRow
                key={e.row.id}
                enriched={e}
                onSelect={onSelect}
                onLaunchDateChange={onLaunchDateChange}
                onDragStart={() => setDragId(e.row.id)}
                onDragOver={ev => { ev.preventDefault() }}
                onDrop={() => {
                  if (!dragId || dragId === e.row.id) return
                  onPriorityChange?.(dragId, e.row.priority_order ?? 0)
                  setDragId(null)
                }}
                isDragging={dragId === e.row.id}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

interface ListRowProps {
  enriched:    EnrichedRow
  onSelect:    (id: string) => void
  onLaunchDateChange?: (projectId: string, iso: string | null) => Promise<void> | void
  onDragStart: () => void
  onDragOver:  (ev: React.DragEvent) => void
  onDrop:      () => void
  isDragging:  boolean
}

function ListRow({ enriched, onSelect, onLaunchDateChange, onDragStart, onDragOver, onDrop, isDragging }: ListRowProps) {
  const { row, activity, stall, daysToLaunch } = enriched
  const isManual = activity.signal === 'manual_override' && activity.manualStatus
  const subTone = isManual
    ? MANUAL_TONE[activity.manualStatus!]
    : SUB_TONE[row.health.subStatus]
  const subLabel = isManual
    ? MANUAL_LABEL[activity.manualStatus!]
    : SUB_LABEL[row.health.subStatus]

  // Predicted launch from the queue projection — surfaced when the AM
  // hasn't pinned a target launch_date yet, so every row has SOMETHING
  // to compare against the team's cap.
  const predictedLaunch = row.queueSlot?.devEndDate ?? null
  const queueRemaining  = row.queueSlot?.remainingDevHours ?? 0

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`${isDragging ? 'opacity-40' : ''} cursor-grab`}
    >
      <div className="flex items-center gap-2 px-2 py-2 hover:bg-wm-bg-hover transition-colors">
        <GripVertical size={13} className="text-wm-text-subtle shrink-0" />
        {/* Priority chip — derived from row order, no manual entry */}
        <span className="w-8 shrink-0 font-mono text-[10.5px] text-wm-text-subtle text-center">
          #{row.priority_order ?? '—'}
        </span>

        {/* Project name — click to open planning. Each downstream
            section is its own clickable region so the row never
            hijacks a click that lands on the date input or pill. */}
        <button
          type="button"
          onClick={() => onSelect(row.id)}
          aria-label={`Open planning for ${row.church_name ?? row.name}`}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-[12.5px] text-wm-text truncate">
            {row.church_name ?? row.name}
          </p>
          <p className="text-[10px] font-mono text-wm-text-subtle">
            #{row.member} · {PHASE_LABEL[activity.phase] ?? activity.phase}
          </p>
        </button>

        {/* Where it is — the new column. Step name + progress + stall
            badge. Visually the loudest text in the row because the
            Monday-morning JTBD is "where is each project?". */}
        <button
          type="button"
          onClick={() => onSelect(row.id)}
          aria-label={`Open planning for ${row.church_name ?? row.name}`}
          className="min-w-0 flex-[1.4] text-left"
        >
          <p className="text-[13px] font-semibold text-wm-text truncate">
            {activity.oneLiner}
          </p>
          {(stall.isStalled || activity.lastActivityAt) && (
            <p className="text-[10px] text-wm-text-subtle font-mono">
              {stall.isStalled
                ? `⚠ Stalled ${stall.daysSinceActivity}d`
                : activity.lastActivityAt
                  ? `Last activity ${fmtRelative(activity.lastActivityAt)}`
                  : ''}
            </p>
          )}
        </button>

        {/* Status — hover for the "why" (risk reasons or the manual
            override reason that drove this pill). */}
        <div
          className="shrink-0"
          title={
            isManual && row.status_reason
              ? `Manual: ${row.status_reason}`
              : (row.health.riskReasons ?? []).length > 0
                ? `Why: ${row.health.riskReasons.join(' · ')}`
                : 'Live status from computeProjectHealth'
          }
        >
          <WMStatusPill tone={subTone} size="sm">
            {subLabel}
          </WMStatusPill>
        </div>

        {/* Launch — inline editable. When the AM hasn't pinned a target,
            shows the predicted dev-end date in italic as a "this is
            when the queue says it ships" placeholder. */}
        <div className="shrink-0 w-32 hidden sm:block">
          <LaunchDateCell
            projectId={row.id}
            launchDate={row.launch_date ? row.launch_date.slice(0, 10) : null}
            predictedDate={predictedLaunch}
            daysToLaunch={daysToLaunch}
            queueRemaining={queueRemaining}
            onCommit={onLaunchDateChange}
          />
        </div>

        <button
          type="button"
          onClick={() => onSelect(row.id)}
          aria-label={`Open planning for ${row.church_name ?? row.name}`}
          className="shrink-0"
        >
          <ChevronRight size={12} className="text-wm-text-subtle" />
        </button>
      </div>
    </li>
  )
}

function LaunchDateCell({
  projectId, launchDate, predictedDate, daysToLaunch, queueRemaining, onCommit,
}: {
  projectId:       string
  launchDate:      string | null
  predictedDate:   string | null
  daysToLaunch:    number | null
  queueRemaining:  number
  onCommit?:       (projectId: string, iso: string | null) => Promise<void> | void
}) {
  const [draft, setDraft] = useState(launchDate ?? '')
  const [saving, setSaving] = useState(false)
  useMemo(() => setDraft(launchDate ?? ''), [launchDate])

  const commit = async () => {
    const next = draft.trim() === '' ? null : draft
    if (next === launchDate) return
    if (!onCommit) return
    setSaving(true)
    try { await onCommit(projectId, next) } finally { setSaving(false) }
  }

  return (
    <div className="text-right" onClick={ev => ev.stopPropagation()}>
      <input
        type="date"
        value={draft}
        disabled={saving}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => void commit()}
        className="w-full text-[11px] font-mono text-wm-text bg-transparent border border-transparent hover:border-wm-border focus:border-wm-accent focus:bg-wm-bg-elevated px-1 py-0.5 rounded outline-none text-right"
      />
      {!launchDate && predictedDate && queueRemaining > 0 ? (
        <p className="text-[10px] font-mono text-wm-text-subtle italic">
          ≈ {predictedDate.slice(5)} predicted
        </p>
      ) : (
        <p className="text-[10px] font-mono text-wm-text-subtle">
          {daysToLaunch == null
            ? ''
            : daysToLaunch < 0
              ? `${Math.abs(daysToLaunch)}d past`
              : `${daysToLaunch}d out`}
        </p>
      )}
    </div>
  )
}

// ── Grouping ──────────────────────────────────────────────────────

interface Group { label: string; items: EnrichedRow[] }

function groupRows(items: EnrichedRow[], by: NonNullable<Props['groupBy']>): Group[] {
  if (by === 'none') return [{ label: '__all__', items }]
  const map = new Map<string, EnrichedRow[]>()
  for (const e of items) {
    const key =
      by === 'phase' ? PHASE_LABEL[e.activity.phase] ?? e.activity.phase
    : by === 'owner' ? (e.row.owner_employee_id ?? 'Unassigned')
    : by === 'month' ? monthKey(e.row.launch_date)
                     : '__all__'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  const out: Group[] = []
  // Phase-grouped order respects PHASE_ORDER_LIST; other groupings sort alpha.
  if (by === 'phase') {
    for (const p of PHASE_ORDER_LIST) {
      const k = PHASE_LABEL[p]
      if (map.has(k)) out.push({ label: k, items: map.get(k)! })
    }
  } else {
    for (const [k, v] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push({ label: k, items: v })
    }
  }
  return out
}

function monthKey(iso: string | null): string {
  if (!iso) return 'No launch date'
  const d = fromIsoDate(iso.slice(0, 10))
  if (!d) return 'No launch date'
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function fmtRelative(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 14) return `${days}d ago`
  if (days < 60) return `${Math.round(days / 7)}w ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
