import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'

/**
 * Click-to-edit text. Single-line by default; pass `multiline` for a
 * textarea. Saves on blur or Cmd/Ctrl+Enter; Escape cancels. No-ops if the
 * value is unchanged. Empty input clears to `null` if `allowEmpty` (default
 * true); otherwise reverts to the original.
 */
export function EditableText({
  value,
  onSave,
  multiline = false,
  placeholder,
  className,
  emptyLabel = 'Add…',
  allowEmpty = true,
}: {
  value: string | null | undefined
  onSave: (next: string | null) => Promise<void>
  multiline?: boolean
  placeholder?: string
  className?: string
  emptyLabel?: string
  allowEmpty?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (editing) {
      setDraft(value ?? '')
      setError(null)
      // Defer focus so the element is mounted
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [editing, value])

  const cancel = () => {
    setEditing(false)
    setDraft(value ?? '')
    setError(null)
  }

  const commit = async () => {
    const trimmed = draft.trim()
    const next = trimmed === '' ? (allowEmpty ? null : value ?? '') : trimmed
    if (next === (value ?? null) || next === value) { setEditing(false); return }
    setPending(true)
    try {
      await onSave(next as string | null)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  if (editing) {
    const sharedProps = {
      ref: inputRef as never,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: () => { if (!pending) void commit() },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); cancel() }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !multiline)) {
          e.preventDefault(); void commit()
        }
      },
      placeholder,
      disabled: pending,
      className: `w-full rounded border border-primary-purple bg-white px-2 py-1 text-sm text-deep-plum outline-none focus:ring-2 focus:ring-primary-purple/30 ${pending ? 'opacity-60' : ''} ${className ?? ''}`,
    }
    return (
      <div>
        {multiline ? <textarea rows={4} {...sharedProps} /> : <input type="text" {...sharedProps} />}
        {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      </div>
    )
  }

  const display = (value ?? '').trim()
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`group inline-flex items-start gap-1.5 text-left rounded hover:bg-lavender-tint/40 transition-colors px-1 -mx-1 ${className ?? ''}`}
    >
      <span className={display ? '' : 'italic text-purple-gray/60'}>
        {display || emptyLabel}
      </span>
      <Pencil
        size={11}
        className="mt-1 opacity-0 group-hover:opacity-50 text-purple-gray transition-opacity shrink-0"
      />
    </button>
  )
}
