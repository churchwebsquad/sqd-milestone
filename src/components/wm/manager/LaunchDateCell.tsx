/**
 * Two-line cell rendering a launch date + relative time below.
 * Used in BoardView rows. Past dates (project not yet launched) get
 * a danger tint to flag overdue commitments.
 */
import { fromIsoDate, formatRelative, daysBetween } from '../../../lib/dateRange'

interface Props {
  launchDate: string | null
  /** When true, this row's project is launched — don't tint past dates. */
  isLaunched?: boolean
  today?: Date
}

export function LaunchDateCell({ launchDate, isLaunched = false, today = new Date() }: Props) {
  const d = fromIsoDate(launchDate)
  if (!d) {
    return <span className="text-[11px] text-wm-text-subtle italic">No launch date</span>
  }
  const gapDays = daysBetween(today, d)
  const overdue = !isLaunched && gapDays < 0
  return (
    <div className="leading-tight">
      <div
        className={[
          'text-[12px] font-semibold',
          overdue ? 'text-wm-danger' : 'text-wm-text',
        ].join(' ')}
      >
        {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
      <div
        className={[
          'text-[10px]',
          overdue ? 'text-wm-danger/80' : 'text-wm-text-muted',
        ].join(' ')}
      >
        {formatRelative(d, today)}
      </div>
    </div>
  )
}
