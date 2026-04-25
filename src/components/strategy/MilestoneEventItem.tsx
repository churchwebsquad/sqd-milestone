import { Link } from 'react-router-dom'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import type { MilestoneEvent } from '../../types/strategy'
import { DepartmentBadge } from './StrategyUI'

/** Feed item for a completed milestone — rendered alongside ProgressEntry
 *  in the merged Progress feed. The checkmark + event copy distinguishes it
 *  from a narrative update. `showInitiative` controls whether the
 *  initiative name is shown (off on the per-initiative detail feed). */
export function MilestoneEventItem({ event, showInitiative = true }: {
  event: MilestoneEvent
  showInitiative?: boolean
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 shrink-0">
        <CheckCircle2 size={16} className="text-primary-purple" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--color-lib-text)] leading-snug">
          <span className="font-semibold">Action Item complete:</span> {event.milestoneName}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-[var(--color-lib-text-muted)]">
          {event.completedAt && <span>{formatDate(event.completedAt)}</span>}
          {showInitiative && event.initiativeId && event.initiativeName && (
            <>
              <span className="text-purple-gray/40">·</span>
              <Link
                to={`/strategy/initiatives/${event.initiativeId}`}
                className="hover:text-primary-purple transition-colors"
              >
                {event.initiativeName}
              </Link>
            </>
          )}
          {showInitiative && <DepartmentBadge department={event.department} size="xs" />}
        </div>
      </div>
      <a
        href={event.notionUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-purple-gray/50 hover:text-primary-purple transition-colors shrink-0"
        title="Open in Notion"
      >
        <ExternalLink size={12} />
      </a>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
