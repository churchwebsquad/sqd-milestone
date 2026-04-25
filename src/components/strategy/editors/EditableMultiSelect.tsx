import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { usePopoverDismiss } from './usePopover'

/** Click-to-edit multi-select. Saves explicitly via the Save button (so
 *  toggling several options in a row only fires one network call). */
export function EditableMultiSelect<V extends string>({
  value,
  options,
  onSave,
  children,
  placeholder = 'Add…',
}: {
  value: V[]
  options: ReadonlyArray<{ value: V; label: string }>
  onSave: (next: V[]) => Promise<void>
  children?: ReactNode
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<V[]>(value)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = usePopoverDismiss<HTMLDivElement>(open, () => { void commit() })

  const reset = () => setDraft(value)
  const toggle = (v: V) => setDraft(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])

  const commit = async () => {
    if (sameSet(draft, value)) { setOpen(false); return }
    setPending(true)
    setError(null)
    try {
      await onSave(draft)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  const display = value.length > 0
    ? (children ?? <span>{value.join(', ')}</span>)
    : <span className="text-purple-gray/60 italic">{placeholder}</span>

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => { reset(); setOpen(true) }}
        disabled={pending}
        className={`rounded hover:bg-lavender-tint/40 transition-colors px-1 -mx-1 ${pending ? 'opacity-60' : ''}`}
      >
        {display}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-[200px] rounded-lg border border-lavender bg-white shadow-lg py-1">
          {options.map(o => {
            const checked = draft.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-deep-plum hover:bg-lavender-tint text-left"
              >
                <span>{o.label}</span>
                {checked && <Check size={11} className="text-primary-purple" />}
              </button>
            )
          })}
        </div>
      )}
      {error && <p className="absolute top-full left-0 mt-1 text-[10px] text-red-600 whitespace-nowrap">{error}</p>}
    </div>
  )
}

function sameSet<V>(a: V[], b: V[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  for (const v of b) if (!sa.has(v)) return false
  return true
}
