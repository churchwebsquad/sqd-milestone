/**
 * Horizontal kanban for the wide Review tab page.
 *
 * Boards render as fixed-width columns (~320 px) in a scrollable
 * flex container — same column primitive as the rail's vertical
 * list, just laid out horizontally with no collapse affordance.
 */
import {
  FeedbackBoardColumn, type FeedbackBoardColumnProps,
} from './FeedbackBoardColumn'
import type { FeedbackBoard } from '../../../lib/webReviews'

export interface FeedbackBoardKanbanProps
  extends Omit<FeedbackBoardColumnProps, 'board' | 'collapsible' | 'defaultCollapsed'> {
  boards: FeedbackBoard[]
}

export function FeedbackBoardKanban({ boards, ...rest }: FeedbackBoardKanbanProps) {
  if (boards.length === 0) {
    return (
      <div className="text-center py-16 px-4 text-[13px] text-wm-text-muted bg-wm-bg-elevated border border-dashed border-wm-border-strong rounded-xl">
        No reviews on this project yet. Start an internal review, share a partner link,
        or request a review to seed the first board.
      </div>
    )
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 snap-x snap-mandatory">
      {boards.map(board => (
        <div
          key={board.reviewId}
          className="snap-start flex-shrink-0 w-[320px] max-h-[calc(100vh-260px)] min-h-[280px] flex"
        >
          <FeedbackBoardColumn board={board} {...rest} />
        </div>
      ))}
    </div>
  )
}
