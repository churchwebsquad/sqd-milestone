/**
 * Shared snippet picker — opens a popover anchored to the trigger
 * button. The popover renders via React Portal to document.body so it
 * escapes the AssistantRail's overflow-clipped container and is
 * always fully visible.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Braces } from 'lucide-react'
import { useSnippetFocus } from './SnippetFocusContext'
import type { FocusedTarget } from './SnippetFocusContext'
import type { WMSnippetOption } from '../RichTextEditor'

interface Props {
  snippets: readonly WMSnippetOption[]
  /** When provided, the menu only enables for that slot's focused
   *  target. When omitted, enables for any focused field. */
  slotKey?: string
  compact?: boolean
}

const POPOVER_WIDTH = 280

export function SnippetMenu({ snippets, slotKey, compact }: Props) {
  const focus = useSnippetFocus()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  // Cache the focused target at the moment the popover opens. The
  // search input inside the popover steals focus, which would clear
  // the SnippetFocusContext's tracking and make insertions miss the
  // original slot. Snapshot here so we can route through it later.
  const capturedTargetRef = useRef<FocusedTarget>(null)

  // Compute popover anchor coords whenever it opens or on layout shifts.
  useLayoutEffect(() => {
    if (!open) return
    const recompute = () => {
      const btn = btnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      // Anchor: top below button, right-aligned with button. Clamp to
      // keep the popover fully inside the viewport.
      const top = Math.min(r.bottom + 4, window.innerHeight - 320)
      const left = Math.max(8, Math.min(r.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8))
      setCoords({ top, left })
    }
    recompute()
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
  }, [open])

  // Close on click outside (handles both the trigger button and the portal).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      const trigger = btnRef.current
      if (trigger?.contains(target)) return
      const popover = document.getElementById('wm-snippet-popover')
      if (popover?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // While the popover is open, prefer the captured target so blur
  // doesn't disable the menu. Refresh the capture each time the
  // popover opens.
  const liveTarget = focus.focused
  const activeTarget = open ? (capturedTargetRef.current ?? liveTarget) : liveTarget
  const enabled = activeTarget != null && (!slotKey || activeTarget.slotKey === slotKey)
  if (snippets.length === 0) return null

  const filtered = query.trim()
    ? snippets.filter(s => `${s.token} ${s.label} ${s.resolvedValue}`.toLowerCase().includes(query.trim().toLowerCase()))
    : snippets

  const handleToggle = () => {
    setOpen(o => {
      if (!o) capturedTargetRef.current = focus.focused
      return !o
    })
  }

  const handleInsert = (s: WMSnippetOption) => {
    const target = capturedTargetRef.current ?? focus.focused
    if (!target) { setOpen(false); return }
    insertIntoTarget(target, s)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseDown={(e) => { e.preventDefault(); handleToggle() }}
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
      {open && coords && createPortal(
        <div
          id="wm-snippet-popover"
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_WIDTH, zIndex: 1000 }}
          className="max-h-80 overflow-hidden rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg flex flex-col"
        >
          <div className="p-2 border-b border-wm-border">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search snippets…"
              className="w-full h-7 px-2 rounded bg-wm-bg border border-wm-border text-[12px] text-wm-text outline-none focus:border-wm-accent"
            />
          </div>
          {!enabled && (
            <p className="px-3 py-2 text-[11px] text-wm-text-subtle italic">
              Click into a field first, then pick a snippet.
            </p>
          )}
          {enabled && (
            <div className="flex-1 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-wm-text-subtle italic">No snippets match.</p>
              ) : filtered.map(s => (
                <button
                  key={s.token}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleInsert(s)
                  }}
                  className="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-wm-bg-hover transition-colors"
                >
                  <div className="font-mono text-wm-accent-strong text-[11px] truncate">{`{{${s.token}}}`}</div>
                  <div className="text-wm-text-muted text-[11px] truncate">{s.resolvedValue || '(empty)'}</div>
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

/** Insert a snippet into a captured focus target. Mirrors the logic in
 *  SnippetFocusContext.insertSnippet but operates on a frozen target
 *  so the snippet popover's search-input focus shift doesn't lose the
 *  original slot reference. */
function insertIntoTarget(target: FocusedTarget, s: WMSnippetOption) {
  if (!target) return
  if (target.kind === 'editor') {
    target.editor.chain().focus().insertSnippet({
      token: s.token,
      label: s.label,
      resolvedValue: s.resolvedValue,
    }).run()
    return
  }
  const input = target.input
  const literal = `{{${s.token}}}`
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? input.value.length
  const next = input.value.slice(0, start) + literal + input.value.slice(end)
  const setter = Object.getOwnPropertyDescriptor(
    input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set
  setter?.call(input, next)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  requestAnimationFrame(() => {
    const pos = start + literal.length
    input.setSelectionRange(pos, pos)
    input.focus()
  })
}
