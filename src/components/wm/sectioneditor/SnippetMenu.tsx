/**
 * Shared snippet picker used inline next to text / richtext slots in
 * the details panel. Resolves the currently-focused target via
 * SnippetFocusContext and inserts a chip (TipTap) or `{{token}}`
 * literal (HTML input).
 */
import { useEffect, useRef, useState } from 'react'
import { Braces } from 'lucide-react'
import { useSnippetFocus } from './SnippetFocusContext'
import type { WMSnippetOption } from '../RichTextEditor'

interface Props {
  snippets: readonly WMSnippetOption[]
  /** Optional explicit slot key — if provided, the menu enables only
   *  when that slot is focused. If omitted, the menu enables when any
   *  slot is focused. */
  slotKey?: string
  compact?: boolean
}

export function SnippetMenu({ snippets, slotKey, compact }: Props) {
  const focus = useSnippetFocus()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  // Close on click outside.
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      const target = e.target as Node
      if (!btnRef.current?.parentElement?.contains(target)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const enabled = focus.focused != null && (!slotKey || focus.focused.slotKey === slotKey)

  if (snippets.length === 0) return null

  return (
    <div className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        // Use mousedown so we open before the focused input loses focus.
        onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o) }}
        className={[
          'inline-flex items-center gap-1 rounded-md border border-wm-border bg-wm-bg-elevated transition-colors',
          compact ? 'h-6 px-1.5 text-[10px]' : 'h-7 px-2 text-[11px]',
          enabled
            ? 'text-wm-accent-strong hover:bg-wm-accent-tint hover:border-wm-accent/40'
            : 'text-wm-text-subtle cursor-not-allowed opacity-60',
        ].join(' ')}
        title={enabled ? 'Insert snippet' : 'Click into a field first'}
      >
        <Braces size={compact ? 10 : 12} />
        <span className="font-semibold">Snippet</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 max-h-80 overflow-auto rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-30 py-1">
          {!enabled && (
            <p className="px-3 py-2 text-[11px] text-wm-text-subtle italic">
              Click into a field first, then pick a snippet.
            </p>
          )}
          {enabled && snippets.map(s => (
            <button
              key={s.token}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                focus.insertSnippet(s)
                setOpen(false)
              }}
              className="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-wm-bg-hover transition-colors"
            >
              <span className="font-mono text-wm-accent-strong text-[11px]">{`{{${s.token}}}`}</span>
              <span className="ml-2 text-wm-text-muted truncate inline-block max-w-[150px] align-middle">
                {s.resolvedValue}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
