/** Pure-display "in 7d" / "3w ago" / "today" relative-time label. */
import { formatRelative } from '../../../lib/dateRange'

interface Props {
  date: string | Date | null
  today?: Date
  className?: string
}

export function RelativeTime({ date, today = new Date(), className }: Props) {
  if (!date) return null
  return (
    <span className={[className, 'text-[11px] text-wm-text-muted whitespace-nowrap'].filter(Boolean).join(' ')}>
      {formatRelative(date, today)}
    </span>
  )
}
