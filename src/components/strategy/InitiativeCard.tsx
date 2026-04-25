import { Link } from 'react-router-dom'
import { ArrowUpRight, Calendar, Activity } from 'lucide-react'
import type { Initiative } from '../../types/strategy'
import { DepartmentBadge, StatusDot, PriorityMark, departmentColor } from './StrategyUI'

/** Single initiative tile. Renders on Command Center grid + the Initiatives
 *  page. Clicking the card routes to the detail page. The left accent bar
 *  uses the dept hue so the grid reads as grouped color even when items are
 *  interleaved. */
export function InitiativeCard({ initiative }: { initiative: Initiative }) {
  const pct = initiative.milestoneCompletionPct
  const accent = departmentColor(initiative.department)

  return (
    <Link
      to={`/strategy/initiatives/${initiative.id}`}
      className="group relative block rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-5 hover:border-[var(--color-lib-border-strong)] transition-colors overflow-hidden"
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: accent }}
      />

      <div className="flex items-start justify-between gap-3 mb-2 pl-2">
        <h3 className="text-base font-semibold tracking-tight text-[var(--color-lib-text)] leading-snug line-clamp-2">
          {initiative.name}
        </h3>
        <ArrowUpRight
          size={14}
          className="text-[var(--color-lib-text-subtle)] group-hover:text-[var(--color-lib-accent)] transition-colors shrink-0 mt-0.5"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 pl-2">
        <DepartmentBadge department={initiative.department} size="xs" />
        <StatusDot status={initiative.status} />
        <PriorityMark priority={initiative.priority} />
      </div>

      {initiative.summary && (
        <p className="text-sm text-[var(--color-lib-text-muted)] leading-snug line-clamp-2 mb-3 pl-2">
          {initiative.summary}
        </p>
      )}

      <div className="pl-2">
        {pct !== null && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--color-lib-text-muted)] mb-1">
              <span className="font-semibold uppercase tracking-wider">Action Items</span>
              <span>{initiative.milestoneCompletedCount}/{initiative.milestoneTotalCount}</span>
            </div>
            <div className="h-1 w-full rounded-full bg-[var(--color-lib-border)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--color-lib-accent)] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 text-[11px] text-[var(--color-lib-text-muted)] pt-2 border-t border-[var(--color-lib-border)] mt-2">
          {initiative.targetQuarter && (
            <span className="inline-flex items-center gap-1">
              <Calendar size={11} />
              {initiative.targetQuarter}
            </span>
          )}
          {typeof initiative.updateCount === 'number' && (
            <span className="inline-flex items-center gap-1">
              <Activity size={11} />
              {initiative.updateCount} update{initiative.updateCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
