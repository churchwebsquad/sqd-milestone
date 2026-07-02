/**
 * FeedbackCard — single review comment in the new feedback UI.
 *
 * Mounts the existing CommentActions component (Apply / Amend) and
 * adds the new metadata around it: page / section pill, gradient
 * avatar, italic quote, category chips, assignee + due date footer.
 * Dismiss lives in a kebab menu so the canvas stays focused on the
 * two primary affordances per the mockup.
 *
 * Visual states:
 *   - Open    (default) — indigo accent stripe, action row visible.
 *   - Editing — orange stripe when comment.kind ∈ (suggested, requested)
 *               and is still open. Implementation in progress feel.
 *   - Completed (applied/amended/dismissed) — green stripe, no action
 *               row, resolution banner with resolver + timestamp.
 *
 * Pure presentational + persistence callbacks; the parent owns
 * refresh after any mutation.
 */
import { useState } from 'react'
import { Check, ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { Avatar } from './Avatar'
import { KindBadge } from './KindBadge'
import { FeedbackStatusPill } from './FeedbackStatusPill'
import { CategoryChip } from './CategoryChip'
import { AssigneePicker, type AssigneeValue } from './AssigneePicker'
import { DueDatePicker } from './DueDatePicker'
import { CommentActions } from '../sectioneditor/CommentActions'
import { useAuth } from '../../../contexts/AuthContext'
import {
  setCommentCategory, setCommentAssignee, setCommentDueDate, resolveComment,
  deleteOwnReviewComment,
} from '../../../lib/webReviews'
import type {
  WebReviewComment, WebReviewCommentCategory,
} from '../../../types/database'

export interface FeedbackCardProps {
  comment: WebReviewComment
  /** Kind + round so the card can render the tags row without joining. */
  reviewKind: 'internal' | 'partner'
  roundNumber: number
  /** Resolved page + section labels for the location pill. */
  pageName: string | null
  sectionLabel: string | null
  /** Section's current field_values, needed for Apply / Amend. */
  sectionFieldValues?: Record<string, unknown>
  /** Click-handler for the page/section pill — caller usually opens
   *  the section in the editor. */
  onJumpToLocation?: () => void
  /** Refresh callback after any mutation (resolve, category change,
   *  assignee, due date). */
  onChanged: () => void | Promise<void>
}

export function FeedbackCard({
  comment, reviewKind, roundNumber, pageName, sectionLabel,
  sectionFieldValues, onJumpToLocation, onChanged,
}: FeedbackCardProps) {
  const isCompleted = comment.status !== 'open'
  const [resolving, setResolving] = useState(false)
  const { user } = useAuth()
  // "My own comment I can delete" gate. Only shown to staff on their
  // own OPEN comments — the RPC would refuse anything else server-
  // side, but hiding the button in those cases keeps the UI honest.
  const canDelete =
    !isCompleted
    && comment.author_kind === 'staff'
    && !!user?.id
    && comment.author_user_id === user.id
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  /** Mark this comment complete without any field change. For internal
   *  comments this is the usual close path ("noted, fixed elsewhere"
   *  or "no action needed"). Persists as status='dismissed' but the
   *  receipt below renders it as "Completed" for internal reviews. */
  const markComplete = async () => {
    setResolving(true)
    try {
      const ok = await resolveComment({
        commentId: comment.id,
        outcome:   'dismissed',
      })
      if (ok) await onChanged()
    } finally {
      setResolving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const ok = await deleteOwnReviewComment({ commentId: comment.id })
      if (ok) await onChanged()
      else setConfirmingDelete(false)
    } finally {
      setDeleting(false)
    }
  }
  const accentColor = isCompleted
    ? 'var(--color-wm-tone-green)'
    : (comment.kind !== 'comment' ? 'var(--color-wm-tone-orange)' : 'var(--color-wm-accent)')

  return (
    <div
      className={[
        'relative bg-wm-bg-elevated border border-wm-border-strong rounded-xl p-3.5 flex flex-col gap-2.5',
        'transition-shadow hover:shadow-md',
        isCompleted ? 'bg-[#FCFCFC]' : '',
      ].join(' ')}
    >
      <span
        aria-hidden
        className="absolute left-[-1px] top-3.5 bottom-3.5 w-[3px] rounded-r-sm"
        style={{ background: accentColor }}
      />

      {/* Tags row */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <KindBadge kind={reviewKind} />
        <FeedbackStatusPill status={comment.status} />
        <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-wm-bg-hover text-wm-text-muted">
          Round {roundNumber}
        </span>
        {comment.category && (
          <CategoryChip
            type={comment.category}
            selected
            onClick={() => void mutate(setCommentCategory(comment.id, null))}
          />
        )}
      </div>

      {/* Location pill */}
      {(pageName || sectionLabel) && (
        <button
          type="button"
          onClick={onJumpToLocation}
          disabled={!onJumpToLocation}
          className="flex items-center gap-1.5 text-[11px] text-wm-text-muted hover:text-wm-text transition-colors disabled:cursor-default disabled:hover:text-wm-text-muted text-left"
        >
          <ExternalLink size={12} className="shrink-0 opacity-70" />
          <span className="text-wm-text font-medium">{pageName ?? '(page)'}</span>
          {sectionLabel && (
            <>
              <span className="text-wm-text-subtle">/</span>
              <span>{sectionLabel}</span>
            </>
          )}
        </button>
      )}

      {/* Author */}
      <div className="flex items-center gap-2">
        <Avatar name={authorDisplayName(comment)} size="md" />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-[12px] font-medium text-wm-text truncate">
            {authorDisplayName(comment)}
          </span>
          <span className="text-[10px] text-wm-text-muted">
            {formatRelative(comment.created_at)}
          </span>
        </div>
      </div>

      {/* Quote */}
      {(comment.body || comment.suggested_value) && (
        <div className="bg-[#FAFAF9] border-l-2 border-wm-border-strong px-3 py-2 rounded-r text-[12px] text-wm-text italic leading-relaxed">
          {comment.body ?? stringify(comment.suggested_value)}
        </div>
      )}

      {/* Category row (only when not already selected — selected chip
          renders inline with tags above) */}
      {!comment.category && !isCompleted && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest font-medium text-wm-text-muted">Type:</span>
          {(['design', 'content'] as WebReviewCommentCategory[]).map(t => (
            <CategoryChip
              key={t}
              type={t}
              selected={false}
              onClick={() => void mutate(setCommentCategory(comment.id, t))}
            />
          ))}
        </div>
      )}

      {/* Action row.
          · Suggested / requested comments carry a proposed value, so
            Apply + Amend resolve them in one click. Dismiss is hidden
            from the card: dismissing requires the user to drill into
            the section first (the "Address" button below).
          · Plain comments have nothing to apply, so the only primary
            action is "Address" — opens the section editor where the
            user can fix the actual content and resolve from there. */}
      {!isCompleted && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {canApplyOrAmend(comment, sectionFieldValues) && (
            <CommentActions
              comment={comment}
              sectionFieldValues={sectionFieldValues}
              onResolved={onChanged}
              hideDismiss
            />
          )}
          {/* Mark complete — closes the comment without writing into the
              section. Primary path for internal observations ("we got
              it, no edit needed") and for any comment where the user
              has already addressed it elsewhere. */}
          <button
            type="button"
            onClick={() => void markComplete()}
            disabled={resolving}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-wm-tone-green/40 bg-wm-tone-green-bg text-wm-tone-green text-[11px] font-semibold hover:border-wm-tone-green transition-colors disabled:opacity-50"
            title={reviewKind === 'internal'
              ? 'Close this internal note without changing the section.'
              : 'Mark this comment resolved without changing the field.'}
          >
            {resolving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            {reviewKind === 'internal' ? 'Mark complete' : 'Resolve'}
          </button>
          {onJumpToLocation && (
            <button
              type="button"
              onClick={onJumpToLocation}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-wm-text text-white text-[11px] font-semibold hover:bg-black transition-colors"
              title="Open this section in the review editor so you can address the feedback in context."
            >
              <ExternalLink size={11} /> Address in editor
            </button>
          )}
          {canDelete && (
            confirmingDelete ? (
              <span className="inline-flex items-center gap-1.5 ml-auto text-[11px]">
                <span className="text-wm-text-muted">Delete?</span>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="font-semibold text-wm-danger hover:underline disabled:opacity-50"
                >
                  {deleting ? 'deleting…' : 'yes, delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="text-wm-text-subtle hover:text-wm-text"
                >
                  cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center justify-center h-7 w-7 ml-auto rounded-md text-wm-text-subtle hover:bg-wm-danger/10 hover:text-wm-danger transition-colors"
                title="Delete this comment (only your own open comments can be deleted)"
                aria-label="Delete comment"
              >
                <Trash2 size={12} />
              </button>
            )
          )}
        </div>
      )}

      {/* Resolution banner */}
      {isCompleted && (
        <ResolutionReceipt comment={comment} reviewKind={reviewKind} />
      )}

      <div className="h-px bg-wm-border my-0.5 -mx-3.5" />

      {/* Footer: assignee + due date */}
      <div className="flex items-center justify-between gap-2">
        <AssigneePicker
          current={comment.assignee_user_id || comment.assignee_name ? {
            userId: comment.assignee_user_id,
            name:   comment.assignee_name,
            email:  comment.assignee_email,
          } : null}
          onChange={(next) => mutate(setCommentAssignee(comment.id, next as AssigneeValue | null))}
          size="sm"
        />
        <DueDatePicker
          value={comment.due_at}
          onChange={(next) => mutate(setCommentDueDate(comment.id, next))}
        />
      </div>
    </div>
  )

  async function mutate(p: Promise<boolean>): Promise<void> {
    const ok = await p
    if (ok) await onChanged()
  }
}

/** Compact resolution banner — "Applied by Emily M. · Nov 19 · 9:08 AM"
 *  with the right color per outcome. Internal "dismissed" reads as
 *  "Completed" since marking an internal note done isn't a dismissal —
 *  there was nothing to apply in the first place. Partner "dismissed"
 *  now reads as "Resolved" — the user-facing framing is that the
 *  strategist resolved the feedback (with edits or by acknowledging
 *  it doesn't need action), not that they dismissed the partner. */
function ResolutionReceipt({
  comment, reviewKind,
}: { comment: WebReviewComment; reviewKind: 'internal' | 'partner' }) {
  const verb = comment.status === 'applied'  ? 'Applied'
            : comment.status === 'amended'  ? 'Amended'
            : comment.status === 'dismissed'
              ? (reviewKind === 'internal' ? 'Completed' : 'Resolved')
              : 'Resolved'
  const tone = comment.status === 'amended' ? 'orange' : 'green'
  const cls = tone === 'green'
    ? 'bg-wm-tone-green-bg text-wm-tone-green'
    : 'bg-wm-tone-orange-bg text-wm-tone-orange'
  return (
    <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] ${cls}`}>
      <span className="font-semibold">{verb}</span>
      {comment.resolved_by_name && <span>by {comment.resolved_by_name}</span>}
      {comment.resolved_at && <span>· {formatShort(comment.resolved_at)}</span>}
    </div>
  )
}

function authorDisplayName(comment: WebReviewComment): string {
  if (comment.author_external_name?.trim()) return comment.author_external_name.trim()
  return comment.author_kind === 'partner' ? 'Partner' : 'Staff'
}

/** Mirrors the same gating CommentActions uses internally — Apply +
 *  Amend only render when the comment proposes a value (suggested or
 *  requested kind) AND we have the section's field_values to patch.
 *  Exposed at the FeedbackCard level so we can decide whether to
 *  mount CommentActions at all vs. showing only "Address in editor". */
function canApplyOrAmend(
  comment: WebReviewComment,
  sectionFieldValues: Record<string, unknown> | undefined,
): boolean {
  return (
    (comment.kind === 'suggested' || comment.kind === 'requested')
    && !!comment.field_key
    && sectionFieldValues !== undefined
  )
}

function stringify(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = Date.now()
  const diff = now - d.getTime()
  const day = 24 * 60 * 60 * 1000
  if (diff < day && d.getDate() === new Date(now).getDate()) {
    return `Today · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  }
  if (diff < 2 * day) {
    return `Yesterday · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  }
  return formatShort(iso)
}

function formatShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}
