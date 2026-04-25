import { useEffect, useRef, useState } from 'react'

/** Click-to-edit number. Saves on blur or Enter. */
export function EditableNumber({
  value,
  onSave,
  step = 1,
  min,
  max,
  placeholder = '—',
}: {
  value: number | null
  onSave: (next: number | null) => Promise<void>
  step?: number
  min?: number
  max?: number
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value !== null ? String(value) : '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) {
      setDraft(value !== null ? String(value) : '')
      setError(null)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [editing, value])

  const commit = async () => {
    const trimmed = draft.trim()
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && Number.isNaN(next)) { setEditing(false); return }
    if (next === value) { setEditing(false); return }
    setPending(true)
    try {
      await onSave(next)
      setEditing(false)
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
          ref={inputRef}
          type="number"
          value={draft}
          step={step}
          min={min}
          max={max}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { if (!pending) void commit() }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
            if (e.key === 'Enter') { e.preventDefault(); void commit() }
          }}
          disabled={pending}
          className="w-16 rounded border border-primary-purple bg-white px-1.5 py-0.5 text-xs text-deep-plum outline-none focus:ring-2 focus:ring-primary-purple/30"
        />
        {error && <span className="text-[10px] text-red-600">{error}</span>}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="rounded hover:bg-lavender-tint/40 transition-colors px-1 -mx-1"
    >
      {value !== null ? value : <span className="text-purple-gray/60 italic">{placeholder}</span>}
    </button>
  )
}
