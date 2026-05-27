/**
 * One feedback board column — used by both the vertical-rail layout
 * and the horizontal kanban. Renders the column header (round label,
 * card count, status pill with menu, kebab) and a stack of FeedbackCards.
 *
 * Layout-agnostic: it just stretches to fill its parent. The vertical
 * list wraps it in a `<details>` for collapsibility; the kanban wraps
 * it in a fixed-width flex item.
 */
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { BoardStatusPill } from './BoardStatusPill'
import { FeedbackCard } from './FeedbackCard'
import { setBoardStatus } from '../../../lib/webReviews'
import type { FeedbackBoard } from '../../../lib/webReviews'
import type { WebReviewComment } from '../../../types/database'

export interface FeedbackBoardColumnProps {
  board: FeedbackBoard
  /** Page name resolver — sections live on pages but the board doesn't
   *  carry a name index; the parent (rail / tab) loads it once and
   *  passes the lookup. */
  pageNameFor: (pageId: string) => string | null
  sectionLabelFor: (sectionId: string | null) => string | null
  sectionFieldValuesFor?: (sectionId: string | null) => Record<string, unknown> | undefined
  onJumpToLocation?: (comment: WebReviewComment) => void
  onChanged: () => void | Promise<void>
  /** Render a collapsible affordance (chevron) — used by the rail. */
  collapsible?: boolean
  /** Whether the column is collapsed initially (only when collapsible). */
  defaultCollapsed?: boolean
  /** Optional inline filter applied to the board's comments before
   *  rendering. The parent computes the filter once and passes a
   *  predicate to keep this component pure. */
  filter?: (c: WebReviewComment) => boolean
  /** Optional slot rendered below the cards (e.g. "Add feedback"
   *  affordance from the AssistantRail context). */
  footerSlot?: ReactNode
}

export function FeedbackBoardColumn({
  board, pageNameFor, sectionLabelFor, sectionFieldValuesFor,
  onJumpToLocation, onChanged, collapsible = false, defaultCollapsed = false,
  filter, footerSlot,
}: FeedbackBoardColumnProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const comments = filter ? board.comments.filter(filter) : board.comments

  return (
    <div className="bg-wm-bg-hover/40 border border-wm-border rounded-xl flex flex-col min-h-0">
      <div className="flex items-start justify-between gap-2 p-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed(c => !c)}
              className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-wm-text-muted hover:text-wm-text hover:bg-wm-bg-hover transition-colors"
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand' : 'Collapse'}
            >
              <ChevronDown
                size={14}
                className={['transition-transform', collapsed ? '-rotate-90' : ''].join(' ')}
              />
            </button>
          )}
          <span className="text-[13px] font-semibold text-wm-text truncate">
            {board.label}{board.kind === 'partner' && board.partnerName ? ` · ${board.partnerName}` : ''}
          </span>
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-black/5 text-wm-text-muted shrink-0">
            {comments.length}
          </span>
        </div>
        <div className="shrink-0">
          <BoardStatusPill
            status={board.status}
            onChange={async (next) => {
              const ok = await setBoardStatus(board.reviewId, next)
              if (ok) await onChanged()
            }}
          />
        </div>
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-2 p-3 pt-0 overflow-y-auto min-h-0">
          {comments.length === 0 && !footerSlot && (
            <div className="bg-wm-bg-elevated border border-dashed border-wm-border-strong rounded-md py-8 px-4 text-center text-[11px] text-wm-text-muted">
              {board.status === 'on_hold'
                ? 'On hold — awaiting partner availability.'
                : board.status === 'completed'
                  ? 'No feedback recorded for this round.'
                  : 'No feedback yet for this round.'}
            </div>
          )}
          {comments.map(c => (
            <FeedbackCard
              key={c.id}
              comment={c}
              reviewKind={board.kind}
              roundNumber={board.roundNumber}
              pageName={pageNameFor(c.web_page_id)}
              sectionLabel={sectionLabelFor(c.web_section_id)}
              sectionFieldValues={sectionFieldValuesFor?.(c.web_section_id)}
              onJumpToLocation={onJumpToLocation ? () => onJumpToLocation(c) : undefined}
              onChanged={onChanged}
            />
          ))}
          {footerSlot}
        </div>
      )}
    </div>
  )
}
