/**
 * Dense row layout for the Web Manager Board view.
 *
 * Each project is one row carrying its priority chip, church + name,
 * current phase, sub-status (on-track / ahead / off-track / blocked /
 * complete), launch date, hours-remaining + capacity bar, and last
 * milestone activity. Click anywhere → open the side panel via the
 * `?edit=<id>` URL param.
 *
 * Sort + filter state is owned by the page-level WebProjectsPage;
 * this component is presentational and receives a sorted, filtered
 * `rows` array.
 */
import { useState } from 'react'
import { ArrowRight, ChevronRight, GripVertical } from 'lucide-react'
import { WMStatusPill } from '../StatusPill'
import { LaunchDateCell } from './LaunchDateCell'
import { MiniCapacityBar } from './MiniCapacityBar'
import { RelativeTime } from './RelativeTime'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'
import type { ProjectSubStatus, WebProjectPhase } from '../../../types/database'

interface Props {
  rows:    ProjectRowVM[]
  loading: boolean
  /** Called when the user clicks a row. The page routes to the
   *  project's Planning tab via /web/:id?tab=planning. */
  onSelect: (projectId: string) => void
  /** Optional. When supplied, rows are draggable; the handler
   *  receives the new id-ordering after a drop. Caller persists
   *  priority_order 1..N. */
  onReorder?: (orderedIds: string[]) => void | Promise<void>
}

// ── Phase + sub-status tone maps ─────────────────────────────

const PHASE_TONE: Record<WebProjectPhase, Parameters<typeof WMStatusPill>[0]['tone']> = {
  intake:   'neutral',
  content:  'info',
  design:   'pink',
  dev:      'blue',
  review:   'yellow',
  launched: 'success',
}

const PHASE_LABEL: Record<WebProjectPhase, string> = {
  intake:   'Intake',
  content:  'Copywriting',
  design:   'Design',
  dev:      'Dev',
  review:   'Final review',
  launched: 'Launched',
}

const SUB_TONE: Record<ProjectSubStatus, Parameters<typeof WMStatusPill>[0]['tone']> = {
  on_track:  'success',
  ahead:     'turquoise',
  off_track: 'warning',
  blocked:   'danger',
  complete:  'neutral',
}

const SUB_LABEL: Record<ProjectSubStatus, string> = {
  on_track:  'On track',
  ahead:     'Ahead',
  off_track: 'Off track',
  blocked:   'Blocked',
  complete:  'Complete',
}

// ── Component ───────────────────────────────────────────────

export function BoardView({ rows, loading, onSelect, onReorder }: Props) {
  // Track the drag in component state so we can highlight drop
  // targets + reorder visually before the server round-trip.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId]         = useState<string | null>(null)

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-wm-bg-hover animate-pulse" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-wm-border bg-wm-bg p-10 text-center">
        <p className="text-sm text-wm-text-muted">
          No projects match these filters.
        </p>
      </div>
    )
  }

  const handleDrop = (targetId: string) => {
    if (!onReorder || !draggingId || draggingId === targetId) {
      setDraggingId(null); setOverId(null)
      return
    }
    const ids = rows.map(r => r.id)
    const from = ids.indexOf(draggingId)
    const to   = ids.indexOf(targetId)
    if (from < 0 || to < 0) {
      setDraggingId(null); setOverId(null)
      return
    }
    const next = [...ids]
    next.splice(from, 1)
    next.splice(to, 0, draggingId)
    setDraggingId(null); setOverId(null)
    void onReorder(next)
  }

  return (
    <ul className="space-y-1.5">
      {rows.map(r => (
        <ProjectRow
          key={r.id}
          row={r}
          onSelect={onSelect}
          draggable={!!onReorder}
          isDragging={draggingId === r.id}
          isDropTarget={overId === r.id && draggingId !== null && draggingId !== r.id}
          onDragStart={() => setDraggingId(r.id)}
          onDragOver={() => setOverId(r.id)}
          onDragLeave={() => setOverId(prev => prev === r.id ? null : prev)}
          onDragEnd={() => { setDraggingId(null); setOverId(null) }}
          onDrop={() => handleDrop(r.id)}
        />
      ))}
    </ul>
  )
}

// ── One row ──────────────────────────────────────────────────

interface RowProps {
  row:          ProjectRowVM
  onSelect:     (id: string) => void
  draggable?:   boolean
  isDragging?:  boolean
  isDropTarget?:boolean
  onDragStart?: () => void
  onDragOver?:  () => void
  onDragLeave?: () => void
  onDragEnd?:   () => void
  onDrop?:      () => void
}

function ProjectRow({
  row, onSelect,
  draggable, isDragging, isDropTarget,
  onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop,
}: RowProps) {
  const phase = (row.current_phase || 'intake') as WebProjectPhase
  const sub   = row.health.subStatus
  const hoursRemain = row.health.remainingHoursAdjusted
  const hoursTotal  = Number(row.dev_hours_estimate ?? 0)
  const churchLine  = row.church_name
    ? `${row.church_name} · #${row.member}`
    : `Member #${row.member}`
  // Consolidated step-aware activity — surfaces "where it is" below
  // the phase pill. Memoized once per project upstream by the hook.
  const activity = row.activity
  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        // Stash the row id on the event so the browser's drag
        // image works; the handler runs on dragstart bubbled up.
        e.dataTransfer.setData('text/plain', row.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      onDragOver={(e) => {
        if (!draggable) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver?.()
      }}
      onDragLeave={() => onDragLeave?.()}
      onDragEnd={() => onDragEnd?.()}
      onDrop={(e) => { e.preventDefault(); onDrop?.() }}
      className={[
        isDragging  ? 'opacity-40' : '',
        isDropTarget ? 'ring-2 ring-wm-accent ring-offset-1 rounded-lg' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        className="w-full text-left rounded-lg border border-wm-border bg-wm-bg-elevated hover:border-wm-border-focus transition-colors px-3 py-2"
      >
        <div className="grid grid-cols-[20px_36px_minmax(180px,1fr)_120px_120px_140px_140px_28px] items-center gap-3">
          {/* Drag handle — only visible when reordering is wired */}
          {draggable ? (
            <span
              aria-hidden
              className="text-wm-text-subtle hover:text-wm-text cursor-grab active:cursor-grabbing flex items-center justify-center"
              title="Drag to reorder priority"
            >
              <GripVertical size={13} />
            </span>
          ) : <span />}

          {/* Priority chip */}
          <PriorityChip n={row.priority_order} />

          {/* Church + project */}
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.08em] font-bold text-wm-text-subtle truncate">
              {churchLine}
            </p>
            <p className="text-[13px] font-semibold text-wm-text truncate">
              {row.name}
            </p>
          </div>

          {/* Phase pill + step descriptor — step name is the new info
              the old board was missing. Stacked so phase stays
              scannable at a glance and step provides depth. */}
          <div className="min-w-0">
            <WMStatusPill tone={PHASE_TONE[phase] ?? 'neutral'} size="sm">
              {PHASE_LABEL[phase] ?? phase}
            </WMStatusPill>
            <p className="text-[10px] text-wm-text-muted truncate mt-0.5">
              {activity.oneLiner}
            </p>
          </div>

          {/* Sub-status pill */}
          <div className="min-w-0">
            <WMStatusPill tone={SUB_TONE[sub] ?? 'neutral'} size="sm">
              {SUB_LABEL[sub] ?? sub}
            </WMStatusPill>
          </div>

          {/* Launch date */}
          <LaunchDateCell
            launchDate={row.launch_date}
            isLaunched={phase === 'launched'}
          />

          {/* Hours + capacity bar */}
          <div className="leading-tight">
            <p className="text-[12px] font-mono tabular-nums text-wm-text">
              {hoursRemain.toFixed(1)}h / {hoursTotal.toFixed(0)}h
            </p>
            <MiniCapacityBar
              used={hoursTotal - hoursRemain}
              total={hoursTotal || hoursRemain || 1}
              width={120}
            />
            {row.latest_milestone_at && (
              <RelativeTime date={row.latest_milestone_at} className="mt-0.5 block" />
            )}
          </div>

          {/* Open arrow — the whole row navigates to the project's
              Planning tab; this just makes the affordance obvious. */}
          <span
            aria-hidden
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-wm-accent-strong"
          >
            <ArrowRight size={13} />
          </span>
        </div>

        {/* Status note + first risk reason inline. Status note (when
            present) is the source of truth; risk reason is only
            surfaced when no status note exists. */}
        {(row.status_note || row.health.riskReasons[0]) && (
          <p className="mt-1 ml-[68px] text-[11px] text-wm-text-muted italic line-clamp-2">
            <ChevronRight size={10} className="inline -mt-0.5" />
            {' '}{row.status_note || row.health.riskReasons[0]}
          </p>
        )}
      </button>
    </li>
  )
}

function PriorityChip({ n }: { n: number | null }) {
  if (n == null) {
    return (
      <span className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-wm-bg-hover text-wm-text-subtle text-[10px] font-mono">
        —
      </span>
    )
  }
  const tone =
    n <= 3 ? 'bg-wm-accent text-white'
    : n <= 8 ? 'bg-wm-accent-tint text-wm-accent-strong'
    :         'bg-wm-bg-hover text-wm-text-muted'
  return (
    <span className={[
      'inline-flex items-center justify-center h-7 w-7 rounded-md text-[11px] font-bold font-mono',
      tone,
    ].join(' ')}>
      P{n}
    </span>
  )
}
