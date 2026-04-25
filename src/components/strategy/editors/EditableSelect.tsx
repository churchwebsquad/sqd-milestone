import { useState, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { usePopoverDismiss } from './usePopover'

export interface SelectOption<V extends string> {
  value: V
  label: string
  /** Optional custom render for the readonly state (e.g. StatusDot). */
  render?: ReactNode
}

/** Click-to-edit single-select. Reuses existing display components by
 *  passing them in as `children` (the resting state) — open delta still
 *  swaps in a popover with the option list. */
export function EditableSelect<V extends string>({
  value,
  options,
  onSave,
  allowClear = true,
  placeholder = '—',
  children,
}: {
  value: V | null | undefined
  options: ReadonlyArray<SelectOption<V>>
  onSave: (next: V | null) => Promise<void>
  allowClear?: boolean
  placeholder?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = usePopoverDismiss<HTMLDivElement>(open, () => setOpen(false))

  const choose = async (next: V | null) => {
    if (next === (value ?? null)) { setOpen(false); return }
    setPending(true)
    setError(null)
    try {
      await onSave(next)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  const current = options.find(o => o.value === value)
  const display = children ?? (current ? current.label : <span className="text-purple-gray/60 italic">{placeholder}</span>)

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={pending}
        className={`rounded hover:bg-lavender-tint/40 transition-colors px-1 -mx-1 ${pending ? 'opacity-60' : ''}`}
      >
        {display}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-[180px] rounded-lg border border-lavender bg-white shadow-lg py-1">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => choose(o.value)}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-deep-plum hover:bg-lavender-tint text-left"
            >
              <span>{o.render ?? o.label}</span>
              {o.value === value && <Check size={11} className="text-primary-purple" />}
            </button>
          ))}
          {allowClear && value !== null && value !== undefined && (
            <>
              <div className="my-1 h-px bg-lavender" />
              <button
                type="button"
                onClick={() => choose(null)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-purple-gray hover:bg-lavender-tint text-left"
              >
                <X size={11} />
                Clear
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="absolute top-full left-0 mt-1 text-[10px] text-red-600 whitespace-nowrap">{error}</p>}
    </div>
  )
}
