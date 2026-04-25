import { useEffect, useState } from 'react'
import { Send, X } from 'lucide-react'
import { createProgress, getInitiativeDetail } from '../../../lib/strategyNotion'
import type { Milestone, ProgressCategory, ProgressEntry } from '../../../types/strategy'

const CATEGORIES: Array<{ value: ProgressCategory; label: string }> = [
  { value: 'progress', label: 'Progress' },
  { value: 'decision', label: 'Decision' },
  { value: 'resource', label: 'Resource' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'intel',    label: 'Intel' },
  { value: 'blocker',  label: 'Blocker' },
]

/** Inline form for posting a Progress update on the Initiative Detail.
 *  Author is set server-side; we don't ask the user to pick.
 *
 *  Action Item linkage: when `presetActionItemId` is passed (e.g. from the
 *  Action Item detail page), the form is pre-tagged with that Action
 *  Item and the picker is hidden. Otherwise the picker fetches the
 *  initiative's Action Items so the user can attach the update to one of
 *  them — leaving it blank still records the update on the initiative
 *  itself. */
export function PostProgressForm({
  initiativeId, presetActionItemId, onPosted, onCancel,
}: {
  initiativeId: string
  presetActionItemId?: string
  onPosted: (entry: ProgressEntry) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [categories, setCategories] = useState<ProgressCategory[]>(['progress'])
  const [actionItemId, setActionItemId] = useState<string>(presetActionItemId ?? '')
  const [actionItems, setActionItems] = useState<Milestone[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lazy-load this initiative's Action Items only when the picker is
  // shown (no preset). Caches in component state — one fetch per mount.
  useEffect(() => {
    if (presetActionItemId || !initiativeId) return
    let cancelled = false
    getInitiativeDetail(initiativeId)
      .then(b => { if (!cancelled) setActionItems(b.milestones) })
      .catch(() => { if (!cancelled) setActionItems([]) })
    return () => { cancelled = true }
  }, [initiativeId, presetActionItemId])

  const toggle = (c: ProgressCategory) =>
    setCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])

  const submit = async () => {
    if (!title.trim()) { setError('Title is required'); return }
    setSubmitting(true)
    setError(null)
    try {
      const entry = await createProgress({
        initiativeId,
        title: title.trim(),
        body: body.trim(),
        categories,
        actionItemIds: actionItemId ? [actionItemId] : undefined,
      })
      onPosted(entry)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-primary-purple/30 bg-lavender-tint/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-deep-plum uppercase tracking-widest">
          New Progress Update
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-purple-gray/60 hover:text-deep-plum"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>

      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="What happened? (one-line summary)"
        autoFocus
        className="w-full rounded border border-lavender bg-white px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
      />

      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Optional details, decisions, or context (plain text — formatting collapses on save)"
        rows={4}
        className="w-full rounded border border-lavender bg-white px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
      />

      {/* Action Item linkage. */}
      {presetActionItemId ? (
        // Posting from inside an Action Item detail page: the preset
        // is auto-applied and the picker is hidden. Surface a chip so
        // the author sees that the link will be set on save — staff
        // were missing the cue and assumed updates posted from the
        // Action Item page weren't being tied back to it.
        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-purple/10 text-primary-purple text-[11px] font-semibold px-2.5 py-1 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-purple" />
          Linking this update to the current Action Item
        </div>
      ) : (
        // Free-form posting (Initiative detail or Progress page) lets
        // the author optionally attach to one of the initiative's
        // Action Items.
        <div className="grid grid-cols-[100px_1fr] items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-deep-plum">
            Action Item
          </label>
          <select
            value={actionItemId}
            onChange={e => setActionItemId(e.target.value)}
            disabled={actionItems === null}
            className="rounded border border-lavender bg-white px-2 py-1.5 text-xs text-deep-plum outline-none focus:border-primary-purple"
          >
            <option value="">— None (initiative-level update) —</option>
            {(actionItems ?? []).map(ai => (
              <option key={ai.id} value={ai.id}>{ai.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map(c => (
          <button
            key={c.value}
            type="button"
            onClick={() => toggle(c.value)}
            className={[
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              categories.includes(c.value)
                ? 'bg-primary-purple text-white'
                : 'bg-white border border-lavender text-deep-plum hover:border-primary-purple/40',
            ].join(' ')}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:bg-lavender-tint"
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !title.trim()}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary-purple text-white text-xs font-semibold px-3 py-1.5 hover:bg-deep-plum disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={11} />
          {submitting ? 'Posting…' : 'Post update'}
        </button>
      </div>
    </div>
  )
}
