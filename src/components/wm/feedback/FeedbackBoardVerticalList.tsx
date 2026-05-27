/**
 * Vertical stack of feedback boards for the narrow side rail.
 *
 * Each board renders as a collapsible column; first non-completed
 * board is expanded by default, the rest collapse so the rail isn't
 * a wall of cards at first glance.
 */
import {
  FeedbackBoardColumn, type FeedbackBoardColumnProps,
} from './FeedbackBoardColumn'
import type { FeedbackBoard } from '../../../lib/webReviews'

export interface FeedbackBoardVerticalListProps
  extends Omit<FeedbackBoardColumnProps, 'board' | 'collapsible' | 'defaultCollapsed'> {
  boards: FeedbackBoard[]
}

export function FeedbackBoardVerticalList({ boards, ...rest }: FeedbackBoardVerticalListProps) {
  // Expand the first non-completed board; collapse the rest. Falls back
  // to expanding the first board if every board is completed.
  const firstOpenIdx = (() => {
    const idx = boards.findIndex(b => b.status !== 'completed')
    return idx >= 0 ? idx : 0
  })()

  if (boards.length === 0) {
    return (
      <div className="text-center py-8 px-4 text-[12px] text-wm-text-muted">
        No reviews yet. Start an internal review or share a partner link.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {boards.map((board, i) => (
        <FeedbackBoardColumn
          key={board.reviewId}
          board={board}
          collapsible
          defaultCollapsed={i !== firstOpenIdx}
          {...rest}
        />
      ))}
    </div>
  )
}
