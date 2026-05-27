/**
 * Inline date picker for the feedback card footer.
 *
 * Native HTML5 `<input type="date">` wrapped to match the card's tone.
 * Renders "No due date" when null; clicking the cell focuses the
 * hidden input so the date popover opens. Overdue dates color the
 * label red.
 *
 * Keeps state-handling simple — caller passes value (ISO date string
 * or null) and an onChange handler that persists via setCommentDueDate.
 */
import { Calendar } from 'lucide-react'
import { useId, useRef } from 'react'

export interface DueDatePickerProps {
  value: string | null  // ISO date or null
  onChange: (next: string | null) => void | Promise<void>
  disabled?: boolean
}

export function DueDatePicker({ value, onChange, disabled }: DueDatePickerProps) {
  const inputId = useId()
  const ref = useRef<HTMLInputElement | null>(null)

  const isOverdue = value ? isPastDate(value) : false
  const label = value ? formatShortDate(value) : 'Set due date'

  return (
    <label
      htmlFor={inputId}
      className={[
        'relative inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer select-none',
        isOverdue ? 'text-wm-danger' : 'text-wm-text-muted',
        disabled  ? 'opacity-50 cursor-not-allowed' : 'hover:text-wm-text',
      ].join(' ')}
      onClick={() => {
        // showPicker is the modern API; fall back to focus for browsers
        // that don't support it (Safari < 16.4).
        if (ref.current && !disabled) {
          if ('showPicker' in ref.current && typeof ref.current.showPicker === 'function') {
            try { ref.current.showPicker() } catch { ref.current.focus() }
          } else {
            ref.current.focus()
          }
        }
      }}
    >
      <Calendar size={12} />
      <span>{label}{isOverdue ? ' · Overdue' : ''}</span>
      <input
        ref={ref}
        id={inputId}
        type="date"
        disabled={disabled}
        value={value ? toDateInputValue(value) : ''}
        onChange={e => {
          const v = e.target.value
          void onChange(v ? new Date(v).toISOString() : null)
        }}
        className="absolute inset-0 opacity-0 pointer-events-none"
        aria-label="Due date"
      />
    </label>
  )
}

function toDateInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isPastDate(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}
