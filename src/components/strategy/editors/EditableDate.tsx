import { useState } from 'react'
import { Calendar, X } from 'lucide-react'

/** Click-to-edit ISO date. Pops a native date input.
 *
 *  Save behavior: the input stays open while the user clicks through
 *  the picker / steps with arrow keys / types. We commit on **blur**
 *  (or Enter, which we route to a programmatic blur). Saving on every
 *  `onChange` was the previous behavior and made the input close mid-
 *  edit — every arrow-key step or typed digit would fire a save and
 *  yank focus.
 *
 *  Timezone: ISO date strings like `2026-04-25` parse as UTC midnight
 *  with `new Date(...)`, which renders as the previous day in any
 *  timezone west of UTC. Both the value-clamping into the `<input>`
 *  and the read-only chip's display split the date by hand to keep
 *  everything in calendar terms. */
export function EditableDate({
  value,
  onSave,
  allowClear = true,
  placeholder = 'Pick date',
}: {
  value: string | null
  onSave: (next: string | null) => Promise<void>
  allowClear?: boolean
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(value?.slice(0, 10) ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const beginEdit = () => {
    setDraft(value?.slice(0, 10) ?? '')
    setError(null)
    setEditing(true)
  }

  const commit = async (next: string | null) => {
    setEditing(false)
    if (next === (value ?? null) || next === value?.slice(0, 10)) return
    setPending(true)
    setError(null)
    try {
      await onSave(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1">
        <input
          type="date"
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => void commit(draft || null)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(value?.slice(0, 10) ?? '')
              setEditing(false)
            }
          }}
          disabled={pending}
          className="rounded border border-primary-purple bg-white px-1.5 py-0.5 text-xs text-deep-plum outline-none focus:ring-2 focus:ring-primary-purple/30"
        />
        {allowClear && draft && (
          <button
            type="button"
            // mousedown fires before the input's blur — using onMouseDown
            // lets the clear button win the race, otherwise blur runs
            // first with the current value and the click never lands.
            onMouseDown={e => {
              e.preventDefault()
              setDraft('')
              void commit(null)
            }}
            className="text-purple-gray/60 hover:text-red-500"
            aria-label="Clear date"
          >
            <X size={11} />
          </button>
        )}
        {error && <span className="ml-1 text-[10px] text-red-600">{error}</span>}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={beginEdit}
      className={`inline-flex items-center gap-1 rounded hover:bg-lavender-tint/40 transition-colors px-1 -mx-1 ${pending ? 'opacity-60' : ''}`}
    >
      {value ? formatDate(value) : (
        <span className="inline-flex items-center gap-1 text-purple-gray/60 italic">
          <Calendar size={11} />
          {placeholder}
        </span>
      )}
    </button>
  )
}

/** Render an ISO date as a human chip *in calendar terms*, ignoring
 *  the local timezone offset. `new Date('2026-04-25')` parses as UTC
 *  midnight, which in any timezone west of UTC formats as the day
 *  before — the classic JS date trap. We split the YYYY-MM-DD parts
 *  by hand and feed them to `Date(year, monthIndex, day)` (a *local*
 *  midnight constructor) so the displayed day always matches the
 *  Notion value. */
function formatDate(iso: string): string {
  const parts = iso.slice(0, 10).split('-')
  if (parts.length !== 3) return iso
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return iso
  const d = new Date(year, month - 1, day)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
