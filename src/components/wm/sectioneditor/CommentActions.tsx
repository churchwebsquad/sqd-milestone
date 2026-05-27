/**
 * Resolution action menu for a review comment.
 *
 * Three actions:
 *   - Apply   — writes `suggested_value` into the section's
 *               `field_values[field_key]`, marks comment 'applied'.
 *               Only enabled when comment.kind ∈ (suggested, requested)
 *               AND a field_key is set AND we have access to the
 *               section's current field_values.
 *
 *   - Amend   — opens a small editor pre-filled with `suggested_value`.
 *               Staff tweaks, then writes their final value into the
 *               field. Marks comment 'amended' with the tweak captured
 *               in resolution_note (optional).
 *
 *   - Dismiss — marks comment 'dismissed' without changing any field.
 *               For `requested` kind we REQUIRE a resolution_note so
 *               the partner has an explanation; for other kinds the
 *               note is optional.
 *
 * Two visual modes via `compact`:
 *   - false (default) — buttons render as full-text labels. Used in
 *     the Reviews inbox row.
 *   - true — single icon-only Resolve button that expands the action
 *     menu inline. Used in the Section panel's comment list where
 *     vertical space is tight.
 *
 * Inline expanders avoid modals so the strategist can resolve many
 * comments without losing context.
 */

import { useState } from 'react'
import { Check, ChevronDown, Edit3, Loader2, X } from 'lucide-react'
import { resolveComment } from '../../../lib/webReviews'
import type { WebReviewComment } from '../../../types/database'

interface Props {
  comment: WebReviewComment
  /** Current field_values of the section the comment targets. Needed
   *  to patch the field on Apply / Amend. */
  sectionFieldValues?: Record<string, unknown>
  /** Refresh callback fired after a successful resolution. */
  onResolved: () => Promise<void>
  /** Tighter layout for narrow panels (the section panel inline list). */
  compact?: boolean
  /** When true, the Dismiss affordance is hidden from this component.
   *  Used by the feedback card where dismissing requires drilling into
   *  the section editor first — the card itself only shows resolution-
   *  through-action options (Apply / Amend). */
  hideDismiss?: boolean
}

export function CommentActions({
  comment, sectionFieldValues, onResolved, compact = false, hideDismiss = false,
}: Props) {
  const [mode, setMode] = useState<'idle' | 'amend' | 'dismiss'>('idle')
  const [amendValue, setAmendValue] = useState<string>(stringify(comment.suggested_value))
  const [note, setNote] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Only suggested/requested rows with a field_key + section context
  // can be Applied or Amended.
  const canApplyOrAmend =
    (comment.kind === 'suggested' || comment.kind === 'requested') &&
    !!comment.field_key &&
    sectionFieldValues !== undefined

  // `requested` dismissals require a reason — partners deserve an
  // explanation. Other kinds can dismiss without one.
  const dismissRequiresNote = comment.kind === 'requested'

  const reset = () => { setMode('idle'); setNote(''); setAmendValue(stringify(comment.suggested_value)) }

  const apply = async () => {
    if (!canApplyOrAmend) return
    setSaving(true)
    const ok = await resolveComment({
      commentId: comment.id,
      outcome: 'applied',
      finalValue: comment.suggested_value,
      sectionToPatch: {
        sectionId:          comment.web_section_id!,
        fieldKey:           comment.field_key!,
        currentFieldValues: sectionFieldValues!,
      },
    })
    setSaving(false)
    if (ok) { reset(); await onResolved() }
  }

  const submitAmend = async () => {
    if (!canApplyOrAmend) return
    if (!amendValue.trim()) return
    setSaving(true)
    const ok = await resolveComment({
      commentId: comment.id,
      outcome: 'amended',
      finalValue: amendValue,
      resolutionNote: note.trim() || undefined,
      sectionToPatch: {
        sectionId:          comment.web_section_id!,
        fieldKey:           comment.field_key!,
        currentFieldValues: sectionFieldValues!,
      },
    })
    setSaving(false)
    if (ok) { reset(); await onResolved() }
  }

  const submitDismiss = async () => {
    if (dismissRequiresNote && !note.trim()) return
    setSaving(true)
    const ok = await resolveComment({
      commentId: comment.id,
      outcome: 'dismissed',
      resolutionNote: note.trim() || undefined,
    })
    setSaving(false)
    if (ok) { reset(); await onResolved() }
  }

  // Already resolved — show a status chip rather than action buttons.
  if (comment.status !== 'open') {
    return (
      <span
        className={[
          'inline-flex items-center gap-1 text-[10px] font-semibold',
          comment.status === 'applied'   ? 'text-wm-success' :
          comment.status === 'amended'   ? 'text-wm-success' :
                                            'text-wm-text-subtle',
        ].join(' ')}
      >
        <Check size={9} /> {capitalize(comment.status)}
        {comment.resolution_note && (
          <span className="font-normal text-wm-text-muted italic">— {comment.resolution_note}</span>
        )}
      </span>
    )
  }

  // Inline expanded form (amend or dismiss-with-note)
  if (mode === 'amend') {
    return (
      <div className="mt-2 rounded-md border border-wm-accent/40 bg-wm-accent-tint/40 p-2 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Amend</p>
        <textarea
          value={amendValue}
          onChange={(e) => setAmendValue(e.target.value)}
          rows={3}
          autoFocus
          className="w-full rounded border border-wm-border bg-wm-bg px-2 py-1 text-[12px] text-wm-text outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15"
          placeholder="Final value to write to the field"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="w-full rounded border border-wm-border bg-wm-bg px-2 py-1 text-[11px] text-wm-text outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={reset} className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text">Cancel</button>
          <button
            type="button"
            onClick={() => void submitAmend()}
            disabled={saving || !amendValue.trim()}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-wm-accent text-wm-text-on-accent text-[11px] font-semibold hover:bg-wm-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save amend
          </button>
        </div>
      </div>
    )
  }
  if (mode === 'dismiss') {
    return (
      <div className="mt-2 rounded-md border border-wm-border bg-wm-bg-hover p-2 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Dismiss
          {dismissRequiresNote && <span className="text-wm-danger ml-1.5">(reason required)</span>}
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          autoFocus
          placeholder={dismissRequiresNote
            ? "Why are you dismissing this partner request?"
            : "Reason (optional)"}
          className="w-full rounded border border-wm-border bg-wm-bg px-2 py-1 text-[12px] text-wm-text outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={reset} className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text">Cancel</button>
          <button
            type="button"
            onClick={() => void submitDismiss()}
            disabled={saving || (dismissRequiresNote && !note.trim())}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-wm-text/80 text-wm-bg-elevated text-[11px] font-semibold hover:bg-wm-text transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />} Dismiss
          </button>
        </div>
      </div>
    )
  }

  // Compact: small "Resolve ▾" trigger that expands the action menu inline.
  if (compact) {
    return (
      <CompactActions
        canApplyOrAmend={canApplyOrAmend}
        onApply={() => void apply()}
        onAmend={() => setMode('amend')}
        onDismiss={() => setMode('dismiss')}
        saving={saving}
      />
    )
  }

  // Full layout — three buttons in a row (Dismiss hidden when
  // hideDismiss is set, e.g. on FeedbackCard where dismissal requires
  // viewing the comment in section context first).
  return (
    <div className="flex items-center gap-1.5">
      {canApplyOrAmend && (
        <>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={saving}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-wm-success-bg border border-wm-success/30 text-wm-success text-[11px] font-semibold hover:border-wm-success transition-colors disabled:opacity-50"
            title="Write the suggested value to the field and mark applied"
          >
            <Check size={11} /> Apply
          </button>
          <button
            type="button"
            onClick={() => setMode('amend')}
            disabled={saving}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-wm-accent-tint border border-wm-accent/30 text-wm-accent-strong text-[11px] font-semibold hover:border-wm-accent transition-colors disabled:opacity-50"
          >
            <Edit3 size={11} /> Amend
          </button>
        </>
      )}
      {!hideDismiss && (
        <button
          type="button"
          onClick={() => setMode('dismiss')}
          disabled={saving}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-wm-bg-elevated border border-wm-border text-wm-text-muted text-[11px] font-semibold hover:border-wm-text-subtle hover:text-wm-text transition-colors disabled:opacity-50"
        >
          <X size={11} /> Dismiss
        </button>
      )}
    </div>
  )
}

function CompactActions({
  canApplyOrAmend, onApply, onAmend, onDismiss, saving,
}: {
  canApplyOrAmend: boolean
  onApply: () => void
  onAmend: () => void
  onDismiss: () => void
  saving: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={saving}
        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
      >
        Resolve <ChevronDown size={9} />
      </button>
    )
  }
  return (
    <div className="inline-flex items-center gap-1">
      {canApplyOrAmend && (
        <>
          <button
            type="button"
            onClick={onApply}
            disabled={saving}
            className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-wm-success hover:underline disabled:opacity-50"
          >
            <Check size={9} /> Apply
          </button>
          <button
            type="button"
            onClick={onAmend}
            disabled={saving}
            className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
          >
            <Edit3 size={9} /> Amend
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onDismiss}
        disabled={saving}
        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-wm-text-muted hover:underline disabled:opacity-50"
      >
        <X size={9} /> Dismiss
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[10px] text-wm-text-subtle hover:text-wm-text-muted"
        aria-label="Hide actions"
      >
        ✕
      </button>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

function stringify(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    const obj = v as { label?: unknown; url?: unknown }
    if (typeof obj.label === 'string') return obj.label
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
