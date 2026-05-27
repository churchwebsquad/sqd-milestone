/**
 * Tab strip for filtering feedback boards by round.
 *
 * Renders "All" + one tab per (kind, round) combo with comment counts.
 * Pure controlled component — parent owns active state and the
 * filtering of which boards are visible.
 */
import type { FeedbackBoard, ProjectFeedbackBoards } from '../../../lib/webReviews'

export interface FeedbackTabsProps {
  boards: ProjectFeedbackBoards
  /** Active tab key — 'all' or a `${kind}-${roundNumber}` string. */
  active: string
  onChange: (key: string) => void
}

export function FeedbackTabs({ boards, active, onChange }: FeedbackTabsProps) {
  const tabs: Array<{ key: string; label: string; count: number }> = [
    { key: 'all', label: 'All', count: countOpen(boards.boards) },
    ...boards.boards.map(b => ({
      key:   `${b.kind}-${b.roundNumber}`,
      label: b.label,
      count: b.counts.open,
    })),
  ]

  return (
    <div className="inline-flex gap-1 bg-wm-bg-elevated border border-wm-border rounded-md p-1 overflow-x-auto max-w-full">
      {tabs.map(t => {
        const isActive = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={[
              'px-3 py-1.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors',
              isActive
                ? 'bg-wm-bg-hover text-wm-text'
                : 'text-wm-text-muted hover:text-wm-text',
            ].join(' ')}
            role="tab"
            aria-selected={isActive}
          >
            {t.label}
            <span className={[
              'text-[10px] px-1.5 py-px rounded-full',
              isActive ? 'bg-black/10 text-wm-text' : 'bg-black/5 text-wm-text-muted',
            ].join(' ')}>{t.count}</span>
          </button>
        )
      })}
    </div>
  )
}

function countOpen(boards: FeedbackBoard[]): number {
  return boards.reduce((n, b) => n + b.counts.open, 0)
}
