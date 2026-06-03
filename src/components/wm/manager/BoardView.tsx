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
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { WMStatusPill } from '../StatusPill'
import { LaunchDateCell } from './LaunchDateCell'
import { MiniCapacityBar } from './MiniCapacityBar'
import { RelativeTime } from './RelativeTime'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'
import type { ProjectSubStatus, WebProjectPhase } from '../../../types/database'

interface Props {
  rows:           ProjectRowVM[]
  loading:        boolean
  onSelect:       (projectId: string) => void
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

export function BoardView({ rows, loading, onSelect }: Props) {
  const navigate = useNavigate()

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

  return (
    <ul className="space-y-1.5">
      {rows.map(r => (
        <ProjectRow
          key={r.id}
          row={r}
          onSelect={onSelect}
          onOpen={() => navigate(`/web/${r.id}`)}
        />
      ))}
    </ul>
  )
}

// ── One row ──────────────────────────────────────────────────

interface RowProps {
  row:      ProjectRowVM
  onSelect: (id: string) => void
  onOpen:   () => void
}

function ProjectRow({ row, onSelect, onOpen }: RowProps) {
  const phase = (row.current_phase || 'intake') as WebProjectPhase
  const sub   = row.health.subStatus
  const hoursRemain = row.health.remainingHoursAdjusted
  const hoursTotal  = Number(row.dev_hours_estimate ?? 0)
  const churchLine  = row.church_name || `Member ${row.member}`
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        className="w-full text-left rounded-lg border border-wm-border bg-wm-bg-elevated hover:border-wm-border-focus transition-colors px-3 py-2"
      >
        <div className="grid grid-cols-[36px_minmax(180px,1fr)_120px_120px_140px_140px_64px] items-center gap-3">
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

          {/* Phase pill */}
          <div className="min-w-0">
            <WMStatusPill tone={PHASE_TONE[phase] ?? 'neutral'} size="sm">
              {PHASE_LABEL[phase] ?? phase}
            </WMStatusPill>
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

          {/* Open project workspace */}
          <button
            type="button"
            title="Open project workspace (Intake / Pages / Design / Dev / Review)"
            onClick={(e) => { e.stopPropagation(); onOpen() }}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10px] font-semibold text-wm-accent-strong border border-wm-accent/30 bg-wm-accent-tint hover:bg-wm-accent/15 transition-colors"
          >
            Open
            <ArrowRight size={11} />
          </button>
        </div>

        {/* Status note + first risk reason inline. Status note (when
            present) is the source of truth; risk reason is only
            surfaced when no status note exists. */}
        {(row.status_note || row.health.riskReasons[0]) && (
          <p className="mt-1 ml-12 text-[11px] text-wm-text-muted italic line-clamp-2">
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
