import { useState } from 'react'
import { Plus } from 'lucide-react'
import { createMilestone } from '../../../lib/strategyNotion'
import type { Milestone } from '../../../types/strategy'

/** Inline "+ Add Action Item" row at the bottom of the Action Items list.
 *  Click to expand into a small one-line form: name, optional target date,
 *  Submit. The new item is appended optimistically by the caller. */
export function AddMilestoneRow({ initiativeId, nextOrder, onCreated }: {
  initiativeId: string
  /** Order the new milestone will be assigned (caller's choice — usually
   *  one more than the current highest). */
  nextOrder: number
  onCreated: (m: Milestone) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setTargetDate('')
    setError(null)
  }

  const submit = async () => {
    if (!name.trim()) { setError('Name required'); return }
    setSubmitting(true)
    setError(null)
    try {
      const m = await createMilestone({
        initiativeIds: [initiativeId],
        name: name.trim(),
        order: nextOrder,
        ...(targetDate ? { targetDate } : {}),
      })
      onCreated(m)
      reset()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 py-2.5 text-xs font-semibold text-[var(--color-lib-accent)] hover:bg-[var(--color-lib-accent-soft)] rounded transition-colors"
      >
        <Plus size={12} />
        Add Action Item
      </button>
    )
  }

  return (
    <div className="py-2 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); void submit() }
            if (e.key === 'Escape') { setOpen(false); reset() }
          }}
          autoFocus
          placeholder="Action Item name"
          className="flex-1 rounded border border-[var(--color-lib-accent)] bg-white px-2 py-1.5 text-sm text-[var(--color-lib-text)] outline-none focus:ring-2 focus:ring-[var(--color-lib-accent)]/30"
        />
        <input
          type="date"
          value={targetDate}
          onChange={e => setTargetDate(e.target.value)}
          className="rounded border border-[var(--color-lib-border)] bg-white px-2 py-1.5 text-xs text-[var(--color-lib-text)] outline-none focus:border-[var(--color-lib-accent)]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !name.trim()}
          className="rounded-full bg-[var(--color-lib-accent)] text-white text-xs font-semibold px-3 py-1.5 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50 whitespace-nowrap"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); reset() }}
          className="text-xs text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-text)]"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
