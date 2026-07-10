/**
 * One feedback board column — used by both the vertical-rail layout
 * and the horizontal kanban. Renders the column header (round label,
 * card count, status pill with menu, kebab) and a stack of FeedbackCards.
 *
 * Layout-agnostic: it just stretches to fill its parent. The vertical
 * list wraps it in a `<details>` for collapsibility; the kanban wraps
 * it in a fixed-width flex item.
 */
import { ChevronDown, MoreHorizontal, Copy, Check, Pencil, X, Trash2, Loader2, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BoardStatusPill } from './BoardStatusPill'
import { FeedbackCard } from './FeedbackCard'
import { bulkApplyRequestedEdits, setBoardStatus } from '../../../lib/webReviews'
import { supabase } from '../../../lib/supabase'
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
  /** Fired when the menu's "Add internal review feedback" item is
   *  picked — the parent (ReviewWorkspace) drills into the editor.
   *  Only meaningful for internal boards; menu hides the item
   *  otherwise. */
  onOpenEditor?: (reviewId: string) => void
}

export function FeedbackBoardColumn({
  board, pageNameFor, sectionLabelFor, sectionFieldValuesFor,
  onJumpToLocation, onChanged, collapsible = false, defaultCollapsed = false,
  filter, footerSlot, onOpenEditor,
}: FeedbackBoardColumnProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [bulkApplying, setBulkApplying] = useState(false)
  // Stable sort: open comments / edits first, completed below.
  // Within each tier, preserve incoming order (buildFeedbackBoards
  // already sorts by created_at). Strategist sees what still needs
  // action at the top of every column without losing the audit trail
  // of resolved items.
  const sortedAll = useMemo(() => {
    const open: WebReviewComment[] = []
    const done: WebReviewComment[] = []
    for (const c of board.comments) {
      if (c.status === 'open') open.push(c); else done.push(c)
    }
    return [...open, ...done]
  }, [board.comments])
  const comments = filter ? sortedAll.filter(filter) : sortedAll

  // Count of partner-requested edits that can be bulk-applied (kind
  // requested, still open, field_key + suggested_value populated).
  // Only surfaces on partner boards — internal boards auto-apply on
  // submit so there's nothing to bulk over. Plain "comment"-kind
  // partner feedback (no proposed change) is excluded — those require
  // a strategist judgment call, not a mechanical apply.
  const bulkApplyableCount = useMemo(() => {
    if (board.kind !== 'partner') return 0
    return comments.filter(c =>
      c.kind === 'requested'
      && c.status === 'open'
      && !!c.field_key
      && c.suggested_value !== null
      && c.suggested_value !== undefined,
    ).length
  }, [board.kind, comments])

  const runBulkApply = async () => {
    if (bulkApplyableCount === 0) return
    if (!window.confirm(
      `Apply all ${bulkApplyableCount} partner-requested edit${bulkApplyableCount === 1 ? '' : 's'}? Each pending edit lands on its section's field in one pass. Comment-only feedback (no proposed change) is left alone.`,
    )) return
    setBulkApplying(true)
    const res = await bulkApplyRequestedEdits({
      comments,
      sectionFieldValuesFor: (sid) => sectionFieldValuesFor?.(sid) ?? {},
    })
    setBulkApplying(false)
    if (res.failed > 0) {
      window.alert(`Applied ${res.applied} edit${res.applied === 1 ? '' : 's'}. ${res.failed} failed — check console for details.`)
    }
    await onChanged()
  }

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
        <div className="shrink-0 flex items-center gap-1">
          {bulkApplyableCount > 0 && (
            <button
              type="button"
              onClick={() => void runBulkApply()}
              disabled={bulkApplying}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-wm-accent-strong text-white text-[11px] font-semibold hover:bg-wm-accent transition-colors disabled:opacity-50"
              title={`Apply all ${bulkApplyableCount} partner-requested edit${bulkApplyableCount === 1 ? '' : 's'} at once. Comment-only feedback (no proposed change) is left alone.`}
            >
              {bulkApplying ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
              Apply {bulkApplyableCount} edit{bulkApplyableCount === 1 ? '' : 's'}
            </button>
          )}
          <BoardStatusPill
            status={board.status}
            onChange={async (next) => {
              const ok = await setBoardStatus(board.reviewId, next)
              if (ok) await onChanged()
            }}
          />
          <BoardActionsMenu
            board={board}
            onChanged={onChanged}
            onOpenEditor={onOpenEditor}
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

/** Per-board action menu — surfaces actions that ARE scoped to one
 *  round (this column's review row) so the strategist isn't guessing
 *  whether a top-bar 'Delete round' button is going to nuke the
 *  newest round vs the one they're looking at.
 *
 *  Items:
 *   - Copy review link (label branches by kind: partner vs internal)
 *   - Add feedback to this round (internal only — opens the editor)
 *   - Close round (only when status is open_for_review or
 *     editing_content — preserves history)
 *   - Delete round (hard delete, cascades comments + edits — confirm
 *     before firing) */
function BoardActionsMenu({
  board, onChanged, onOpenEditor,
}: {
  board: FeedbackBoard
  onChanged: () => void | Promise<void>
  onOpenEditor?: (reviewId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const copyLink = async () => {
    if (!board.partnerToken) return
    const url = `${window.location.origin}/portal/review/${board.partnerToken}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Review link — paste it to a teammate:', url)
    }
  }

  const closeRound = async () => {
    if (!window.confirm(`Close ${board.label}? Open comments stay attached to their pages so the next round can pick them up.`)) return
    const ok = await setBoardStatus(board.reviewId, 'completed')
    if (ok) await onChanged()
    setOpen(false)
  }

  const deleteRound = async () => {
    if (!window.confirm(
      `Delete ${board.label}? Every comment + edit attached to it is removed. This can't be undone.`,
    )) return
    const { error } = await supabase.from('web_reviews').delete().eq('id', board.reviewId)
    if (error) {
      window.alert(`Couldn't delete the round: ${error.message}`)
      return
    }
    await onChanged()
    setOpen(false)
  }

  const canClose = board.status === 'open_for_review' || board.status === 'editing_content'
  const isInternal = board.kind === 'internal'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center justify-center w-6 h-6 rounded text-wm-text-muted hover:text-wm-text hover:bg-wm-bg-hover transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Manage ${board.label}`}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 min-w-[220px] rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg py-1 text-[12px]"
        >
          {board.partnerToken && (
            <button
              type="button"
              onClick={() => void copyLink()}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-wm-text hover:bg-wm-bg-hover"
            >
              {copied ? <Check size={12} className="text-wm-success" /> : <Copy size={12} />}
              {copied
                ? 'Link copied'
                : isInternal
                  ? 'Copy internal round link'
                  : 'Copy partner review link'}
            </button>
          )}
          {isInternal && onOpenEditor && (
            <button
              type="button"
              onClick={() => { onOpenEditor(board.reviewId); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-wm-text hover:bg-wm-bg-hover"
            >
              <Pencil size={12} />
              Add my feedback to this round
            </button>
          )}
          {canClose && (
            <button
              type="button"
              onClick={() => void closeRound()}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-wm-text hover:bg-wm-bg-hover"
            >
              <X size={12} />
              Close round
            </button>
          )}
          <button
            type="button"
            onClick={() => void deleteRound()}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-wm-danger hover:bg-wm-danger-bg"
          >
            <Trash2 size={12} />
            Delete round
          </button>
        </div>
      )}
    </div>
  )
}
