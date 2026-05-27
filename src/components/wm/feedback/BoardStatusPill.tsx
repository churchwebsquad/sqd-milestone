/**
 * Board-level status pill — the 5-state indicator that sits in each
 * column header / vertical-board header in the feedback UI.
 *
 * The pill is interactive: clicking opens a small menu so the
 * strategist can move the board through states without leaving the
 * boards view. The "no menu" rendering (used in the rail's compact
 * boards) is also supported.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { WMStatusPill, type WMStatusTone } from '../StatusPill'
import type { BoardStatus } from '../../../types/database'

const LABELS: Record<BoardStatus, string> = {
  no_status:        'No status',
  open_for_review:  'Open for review',
  editing_content:  'Editing',
  on_hold:          'On hold',
  completed:        'Completed',
}

const TONES: Record<BoardStatus, WMStatusTone> = {
  no_status:        'neutral',
  open_for_review:  'blue',
  editing_content:  'orange',
  on_hold:          'yellow',
  completed:        'green',
}

const ORDER: readonly BoardStatus[] = [
  'no_status', 'open_for_review', 'editing_content', 'on_hold', 'completed',
]

export interface BoardStatusPillProps {
  status: BoardStatus
  /** When provided, the pill is clickable and opens a menu. */
  onChange?: (next: BoardStatus) => void | Promise<void>
  size?: 'sm' | 'md'
}

export function BoardStatusPill({ status, onChange, size = 'sm' }: BoardStatusPillProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pill = (
    <WMStatusPill tone={TONES[status]} size={size}>
      <span className="inline-flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
        {LABELS[status]}
        {onChange && <ChevronDown size={10} className="opacity-70" />}
      </span>
    </WMStatusPill>
  )

  if (!onChange) return pill

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {pill}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute z-30 top-full mt-1 left-0 min-w-[160px] rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg py-1"
        >
          {ORDER.map(s => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={s === status}
              onClick={async () => {
                setOpen(false)
                if (s !== status) await onChange(s)
              }}
              className={[
                'w-full text-left px-3 py-1.5 text-[12px] hover:bg-wm-bg-hover flex items-center gap-2',
                s === status ? 'font-semibold text-wm-text' : 'text-wm-text-muted',
              ].join(' ')}
            >
              <span className="inline-flex items-center justify-center w-3">
                <span className={`w-1.5 h-1.5 rounded-full bg-wm-tone-${TONES[s] === 'neutral' ? 'yellow' : TONES[s]}`} style={{
                  background: dotColorFor(s),
                }} />
              </span>
              {LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Inline color for the menu dots — avoids depending on Tailwind
 *  bg-wm-tone-* arbitrary values matching by string interpolation. */
function dotColorFor(status: BoardStatus): string {
  switch (status) {
    case 'no_status':       return 'var(--color-wm-text-subtle)'
    case 'open_for_review': return 'var(--color-wm-tone-blue)'
    case 'editing_content': return 'var(--color-wm-tone-orange)'
    case 'on_hold':         return 'var(--color-wm-tone-yellow)'
    case 'completed':       return 'var(--color-wm-tone-green)'
  }
}
