/**
 * Web Manager — Phase board (kanban).
 *
 * One column per current_phase (intake / content / design / dev /
 * review / launched). Projects render as cards inside the column
 * matching their `current_phase`. At-a-glance answer to "what stage
 * is every project in?" — the missing piece between the dense Board
 * list and the per-week Schedule grid.
 *
 * Drag-to-advance is deferred. Clicking a card jumps to the
 * project's Planning tab (same nav as Board view rows).
 *
 * Source data is `ProjectRowVM[]` from useProjectsWithHealth, already
 * filtered + sorted by the parent. The component is presentational.
 */
import { useMemo } from 'react'
import { ChevronRight, Clock } from 'lucide-react'
import { WMStatusPill } from '../StatusPill'
import type { ProjectRowVM } from '../../../hooks/useProjectsWithHealth'
import type { ProjectSubStatus, WebProjectPhase } from '../../../types/database'

/** Inline launch-date formatter — keep the card compact (the
 *  manager-level LaunchDateCell is too verbose for a kanban card). */
function formatLaunchShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Props {
  rows:    ProjectRowVM[]
  loading: boolean
  onSelect: (projectId: string) => void
}

const PHASE_ORDER: WebProjectPhase[] = [
  'intake', 'content', 'design', 'dev', 'review', 'launched',
]
const PHASE_LABEL: Record<WebProjectPhase, string> = {
  intake:   'Intake',
  content:  'Content',
  design:   'Design',
  dev:      'Dev',
  review:   'Final review',
  launched: 'Launched',
}
// Phase chrome is intentionally neutral. Phase identity comes from
// the column header label, NOT a column color — we reserve
// emerald/amber/rose for health/capacity semantics across the whole
// /web surface so an "on-track" emerald pill in a "launched" column
// doesn't read as duplicated meaning.
const PHASE_TONE = 'border-wm-border bg-wm-bg-elevated'
const PHASE_ACCENT: Record<WebProjectPhase, string> = {
  intake:   'bg-wm-text-subtle',
  content:  'bg-wm-text-muted',
  design:   'bg-wm-accent/70',
  dev:      'bg-wm-accent',
  review:   'bg-wm-accent/90',
  launched: 'bg-wm-text-muted',
}

const SUB_TONE: Record<ProjectSubStatus, Parameters<typeof WMStatusPill>[0]['tone']> = {
  on_track: 'success', ahead: 'turquoise', off_track: 'warning',
  blocked: 'danger', complete: 'neutral',
}
const SUB_LABEL: Record<ProjectSubStatus, string> = {
  on_track: 'On track', ahead: 'Ahead', off_track: 'Off track',
  blocked: 'Blocked', complete: 'Complete',
}

export function PhaseBoardView({ rows, loading, onSelect }: Props) {
  // Bucket projects by current_phase. Maintain the input order
  // within each bucket (the parent already sorts by priority).
  const byPhase = useMemo<Record<WebProjectPhase, ProjectRowVM[]>>(() => {
    const acc: Record<WebProjectPhase, ProjectRowVM[]> = {
      intake: [], content: [], design: [], dev: [], review: [], launched: [],
    }
    for (const r of rows) {
      const phase = (r.current_phase ?? 'intake') as WebProjectPhase
      if (acc[phase]) acc[phase].push(r)
      else acc.intake.push(r)
    }
    return acc
  }, [rows])

  if (loading) {
    return (
      <div className="overflow-x-auto -mx-2 px-2 pb-2">
        <div className="flex gap-3 lg:grid lg:grid-cols-6 min-w-max lg:min-w-0">
          {PHASE_ORDER.map(p => (
            <div key={p} className="rounded-lg border border-wm-border bg-wm-bg-elevated p-3 min-h-[200px] min-w-[220px] w-[220px] lg:w-auto lg:min-w-0">
              <div className="h-4 w-20 bg-wm-bg-hover rounded animate-pulse mb-3" />
              <div className="space-y-2">
                {[0, 1].map(i => (
                  <div key={i} className="h-16 bg-wm-bg-hover rounded animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    // Horizontal scroll on mobile/tablet — each column keeps its full
    // width and the user pans through phases. On large screens the
    // six columns lay out side-by-side. Avoids the "stack with
    // section headers buried mid-column" mobile UX.
    <div className="overflow-x-auto -mx-2 px-2 pb-2">
      <div className="flex gap-3 lg:grid lg:grid-cols-6 min-w-max lg:min-w-0">
        {PHASE_ORDER.map(phase => {
          const items = byPhase[phase]
          return (
          <div
            key={phase}
            className={`rounded-lg border ${PHASE_TONE} flex flex-col min-w-[220px] w-[220px] lg:w-auto lg:min-w-0`}
          >
            <div className="px-3 py-2 border-b border-wm-border flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full ${PHASE_ACCENT[phase]} shrink-0`} />
                <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text truncate">
                  {PHASE_LABEL[phase]}
                </p>
              </div>
              <span className="text-[11px] font-mono text-wm-text-muted shrink-0">
                {items.length}
              </span>
            </div>
            <div className="p-2 space-y-2 flex-1 min-h-[120px] overflow-y-auto max-h-[70vh]">
              {items.length === 0 ? (
                <p className="text-[11px] text-wm-text-subtle italic text-center py-4">
                  No projects here
                </p>
              ) : (
                items.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelect(r.id)}
                    aria-label={`Open planning for ${r.church_name ?? r.name}`}
                    className="w-full text-left rounded-md border border-wm-border bg-wm-bg px-2.5 py-2 hover:border-wm-accent hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start justify-between gap-1.5 mb-1">
                      <p className="text-[12px] font-semibold text-wm-text leading-tight truncate flex-1">
                        {r.church_name ?? r.name}
                      </p>
                      <ChevronRight size={11} className="text-wm-text-subtle shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <WMStatusPill tone={SUB_TONE[r.health.subStatus]} size="sm">
                        {SUB_LABEL[r.health.subStatus]}
                      </WMStatusPill>
                      {r.priority_order != null && (
                        <span className="text-[10px] font-mono text-wm-text-subtle">
                          #{r.priority_order}
                        </span>
                      )}
                    </div>
                    {r.launch_date && (
                      <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-wm-text-muted">
                        <Clock size={9} className="text-wm-text-subtle" />
                        <span>{formatLaunchShort(r.launch_date)}</span>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )
        })}
      </div>
    </div>
  )
}
