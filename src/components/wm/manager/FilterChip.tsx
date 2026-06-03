/** Toggleable filter chip with optional count badge.
 *
 *  Visual: pill, accent border + tint when active, muted when not.
 *  Click anywhere → toggles. The optional `count` lets the caller
 *  surface how many projects would match if selected. */
import { Check } from 'lucide-react'

interface Props {
  active: boolean
  onToggle: () => void
  children: React.ReactNode
  count?: number
}

export function FilterChip({ active, onToggle, children, count }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors border',
        active
          ? 'bg-wm-accent-tint text-wm-accent-strong border-wm-accent/30'
          : 'bg-wm-bg-elevated text-wm-text-muted border-wm-border hover:border-wm-border-focus',
      ].join(' ')}
    >
      {active && <Check size={10} />}
      <span>{children}</span>
      {typeof count === 'number' && (
        <span className={[
          'text-[10px] font-mono tabular-nums',
          active ? 'text-wm-accent-strong/70' : 'text-wm-text-subtle',
        ].join(' ')}>{count}</span>
      )}
    </button>
  )
}
