/**
 * 4px-tall progress bar showing hours-used vs total-allocated.
 * Used in BoardView rows to give an at-a-glance feel for how much of
 * a project's dev budget is committed vs remaining.
 *
 * Three states (matching the slot system on CharCounter):
 *   • under 85% → muted gray  (room to spare)
 *   • 85–100%   → warning yellow
 *   • over 100% → danger red  (over budget)
 */

interface Props {
  used: number     // hours already burned / projected
  total: number    // budget
  width?: number   // px; defaults to 64
}

export function MiniCapacityBar({ used, total, width = 64 }: Props) {
  const safeTotal = total > 0 ? total : 1
  const pct = Math.min(100, (used / safeTotal) * 100)
  const over = used > total
  const warn = !over && used / safeTotal > 0.85
  return (
    <div
      title={`${used.toFixed(1)} of ${total.toFixed(1)}h`}
      className="h-1.5 rounded-full bg-wm-bg-hover overflow-hidden shrink-0"
      style={{ width }}
    >
      <div
        className={[
          'h-full transition-all duration-200',
          over   ? 'bg-wm-danger'
          : warn ? 'bg-wm-warning'
          :        'bg-wm-text-subtle/60',
        ].join(' ')}
        style={{ width: over ? '100%' : `${pct}%` }}
      />
    </div>
  )
}
