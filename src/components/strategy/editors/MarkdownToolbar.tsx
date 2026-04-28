/**
 * Lightweight markdown toolbar for plain-text textareas.
 *
 * Keeps formatting authoring consistent with the rest of the app —
 * Submit Milestone's Step 5 has the same set of buttons + same syntax
 * (`**bold**`, `_italic_`, `` `code` ``, `[text](url)`, bullets,
 * numbered, divider). Wrapped here as a reusable component so the
 * Strategy progress form (and any future plain-text + markdown
 * surface) can pick it up without re-implementing the
 * selection-manipulation logic.
 *
 * Caller responsibilities:
 *   - Render the textarea and pass its ref via `textareaRef`.
 *   - Pass the current value + an `onChange(next)` callback. The
 *     toolbar mutates the value via the standard wrap-selection /
 *     prepend-lines / insert-block primitives.
 */

import { useRef, type ReactNode, type RefObject } from 'react'
import { Bold, Code, Italic, Link as LinkIcon, List, ListOrdered, Minus } from 'lucide-react'
import { insertMarkdownLink } from '../../../lib/markdownInsertLink'

interface MarkdownToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (next: string) => void
}

export function MarkdownToolbar({ textareaRef, value, onChange }: MarkdownToolbarProps) {
  // Local stable ref to value so the toolbar handlers always operate
  // on the latest text — useful when React batches a re-render between
  // the onMouseDown (which prevents focus loss) and the onClick.
  const valueRef = useRef(value)
  valueRef.current = value

  const wrapSelection = (before: string, after: string = before, placeholder = '') => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const v = ta.value
    const selected = v.slice(start, end) || placeholder
    const next = v.slice(0, start) + before + selected + after + v.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + before.length
      ta.setSelectionRange(pos, pos + selected.length)
    })
  }

  const prependLines = (marker: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const v = ta.value
    const lineStart = v.lastIndexOf('\n', start - 1) + 1
    const block = v.slice(lineStart, end || start)
    const lines = block.split('\n')
    const hasSelection = end > start
    const target = hasSelection ? lines : [lines[0] || '']
    const transformed = target.map(l => l.startsWith(marker) ? l : `${marker}${l}`).join('\n')
    const next = v.slice(0, lineStart) + transformed + v.slice(hasSelection ? end : start)
    onChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      const newEnd = lineStart + transformed.length
      ta.setSelectionRange(newEnd, newEnd)
    })
  }

  const insertBlock = (block: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const v = ta.value
    const prefix = start > 0 && v[start - 1] !== '\n' ? '\n' : ''
    const suffix = v[start] !== '\n' ? '\n' : ''
    const insert = prefix + block + suffix
    const next = v.slice(0, start) + insert + v.slice(start)
    onChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + insert.length
      ta.setSelectionRange(pos, pos)
    })
  }

  const onLinkClick = () => {
    const ta = textareaRef.current
    if (!ta) return
    insertMarkdownLink(ta, valueRef.current, onChange)
  }

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 bg-lavender-tint/40 border-b border-lavender">
      <ToolbarButton label="Bold (**text**)" onClick={() => wrapSelection('**', '**', 'bold')}>
        <Bold size={13} />
      </ToolbarButton>
      <ToolbarButton label="Italic (_text_)" onClick={() => wrapSelection('_', '_', 'italic')}>
        <Italic size={13} />
      </ToolbarButton>
      <ToolbarButton label="Inline code (`text`)" onClick={() => wrapSelection('`', '`', 'code')}>
        <Code size={13} />
      </ToolbarButton>
      <ToolbarButton label="Link ([text](url))" onClick={onLinkClick}>
        <LinkIcon size={13} />
      </ToolbarButton>
      <div className="w-px h-5 bg-lavender mx-1" />
      <ToolbarButton label="Bulleted list" onClick={() => prependLines('- ')}>
        <List size={13} />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" onClick={() => prependLines('1. ')}>
        <ListOrdered size={13} />
      </ToolbarButton>
      <ToolbarButton label="Divider (---)" onClick={() => insertBlock('---')}>
        <Minus size={13} />
      </ToolbarButton>
    </div>
  )
}

function ToolbarButton({ label, onClick, children }: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      // mousedown fires before blur — preventDefault keeps the textarea
      // selection alive across the click so wrapSelection has something
      // to wrap.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-purple-gray hover:bg-white hover:text-primary-purple transition-colors"
    >
      {children}
    </button>
  )
}
