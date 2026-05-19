/**
 * Web Manager — RichTextEditor.
 *
 * TipTap-backed rich text input scoped to the editor extensions the
 * user confirmed for v1:
 *   paragraph · headings (H1–H5) · bold · italic · link · bullet
 *   list · ordered list · hard break · code (inline)
 *
 * Two surface paths for formatting:
 *   - Persistent toolbar at the top of the editor (subtle, always
 *     visible when editable) — lets the strategist pick a format
 *     BEFORE typing (e.g. click H2, then write).
 *   - Floating bubble menu on text selection (dark, high-contrast) —
 *     for marking up existing content.
 *
 * The editor commits content as HTML on every update.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, Code, Link as LinkIcon, List, ListOrdered,
  Heading1, Heading2, Heading3, Heading4, Heading5, Type,
  Braces, Search,
} from 'lucide-react'
import { SnippetNode } from './SnippetNode'

export interface WMSnippetOption {
  token: string                 // 'phone', 'church_name', or custom token
  label: string                 // human-readable name
  resolvedValue: string         // current value preview
  source: 'global' | 'custom'   // for grouping in the popover
  description?: string
}

export interface WMRichTextEditorProps {
  value: string
  onChange: (html: string) => void
  /** Allowed heading levels — defaults to H2–H5 (page H1 lives in the page header) */
  headingLevels?: (1 | 2 | 3 | 4 | 5)[]
  placeholder?: string
  /** Single-line variant for slot fields that aren't truly rich. Forces no
   *  newlines and hides the heading buttons. */
  singleLine?: boolean
  readOnly?: boolean
  /** Tighter padding for nested editors inside group items */
  compact?: boolean
  /** Snippets available for insertion via the toolbar's snippet button.
   *  When supplied, the toolbar shows the snippet picker. Each entry
   *  carries its current resolved value, which gets baked into the
   *  chip at insert time (rewritten back to {{token}} on export). */
  snippets?: readonly WMSnippetOption[]
  /** Fires once with the TipTap editor instance after mount, and
   *  again with null on unmount. Lets parent flows (e.g. the section
   *  details panel's SnippetFocusContext) register the editor for
   *  cross-component snippet insertion. */
  onEditorReady?: (editor: Editor | null) => void
  /** Hide the persistent top toolbar (formatting still works via
   *  selection bubble menu + shortcuts). Use inside details panels
   *  where the panel header surfaces the formatting controls. */
  hideToolbar?: boolean
}

export function WMRichTextEditor({
  value, onChange,
  headingLevels = [2, 3, 4, 5],
  placeholder = 'Start writing…',
  singleLine = false,
  readOnly = false,
  compact = false,
  snippets,
  onEditorReady,
  hideToolbar = false,
}: WMRichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: headingLevels },
        blockquote: false,
        horizontalRule: false,
        strike: false,
        dropcursor: false,
        // Disable v3's bundled Link so our own configured Link wins
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: { class: 'text-wm-accent-strong underline' },
      }),
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: true,
      }),
      SnippetNode,
    ],
    content: value,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: [
          'focus:outline-none max-w-none',
          compact ? 'px-2 py-1' : 'px-3 py-2',
        ].join(' '),
      },
      handleKeyDown(_view, event) {
        if (singleLine && event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          return true
        }
        return false
      },
    },
  })

  useEffect(() => {
    if (!onEditorReady) return
    onEditorReady(editor ?? null)
    return () => onEditorReady(null)
  }, [editor, onEditorReady])

  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (current !== value) {
      editor.commands.setContent(value || '', { emitUpdate: false })
    }
  }, [value, editor])

  if (!editor) {
    return (
      <div className={['rounded-md border border-wm-border bg-wm-bg', compact ? 'h-9' : 'h-12'].join(' ')} />
    )
  }

  return (
    <div
      className={[
        'rounded-md border border-wm-border bg-wm-bg-elevated',
        'focus-within:border-wm-border-focus focus-within:ring-2 focus-within:ring-wm-border-focus/15',
        'transition-colors overflow-hidden',
        readOnly ? 'opacity-80' : '',
      ].join(' ')}
    >
      {/* Persistent toolbar */}
      {!readOnly && !hideToolbar && (
        <PersistentToolbar
          editor={editor}
          headingLevels={headingLevels}
          singleLine={singleLine}
          snippets={snippets}
        />
      )}

      {/* Bubble menu on selection — dark, high-contrast */}
      {!readOnly && (
        <BubbleMenu
          editor={editor}
          options={{ placement: 'top' }}
          className="flex items-center gap-0.5 rounded-md bg-wm-text text-wm-bg shadow-lg border border-wm-text/20 p-1"
        >
          <BubbleToolbarContent
            editor={editor}
            headingLevels={headingLevels}
            singleLine={singleLine}
          />
        </BubbleMenu>
      )}

      <EditorContent editor={editor} />
    </div>
  )
}

// ── Persistent top toolbar (subtle, always visible) ───────────────────

function PersistentToolbar({
  editor, headingLevels, singleLine, snippets,
}: {
  editor: Editor
  headingLevels: (1 | 2 | 3 | 4 | 5)[]
  singleLine: boolean
  snippets?: readonly WMSnippetOption[]
}) {
  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-wm-border bg-wm-bg/60 flex-wrap">
      {!singleLine && (
        <>
          <TopButton
            label="Paragraph"
            shortcut="⌘⌥0"
            active={editor.isActive('paragraph') && !editor.isActive('heading')}
            onClick={() => editor.chain().focus().setParagraph().run()}
          >
            <Type size={12} />
          </TopButton>
          {headingLevels.map(level => {
            const Icon = HEADING_ICONS[level]
            return (
              <TopButton
                key={level}
                label={`Heading ${level}`}
                shortcut={`⌘⌥${level}`}
                active={editor.isActive('heading', { level })}
                onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
              >
                <Icon size={12} />
              </TopButton>
            )
          })}
          <TopDivider />
        </>
      )}
      <TopButton
        label="Bold"
        shortcut="⌘B"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={12} />
      </TopButton>
      <TopButton
        label="Italic"
        shortcut="⌘I"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={12} />
      </TopButton>
      <TopButton
        label="Inline code"
        shortcut="⌘E"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={12} />
      </TopButton>
      <TopDivider />
      <TopButton
        label="Link"
        shortcut="⌘K"
        active={editor.isActive('link')}
        onClick={() => promptLink(editor)}
      >
        <LinkIcon size={12} />
      </TopButton>
      {!singleLine && (
        <>
          <TopDivider />
          <TopButton
            label="Bullet list"
            shortcut="⌘⇧8"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={12} />
          </TopButton>
          <TopButton
            label="Ordered list"
            shortcut="⌘⇧7"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={12} />
          </TopButton>
        </>
      )}
      {snippets && snippets.length > 0 && (
        <>
          <TopDivider />
          <SnippetPickerButton editor={editor} snippets={snippets} />
        </>
      )}
    </div>
  )
}

// ── Snippet picker (toolbar button + popover) ─────────────────────────

function SnippetPickerButton({
  editor, snippets,
}: {
  editor: Editor
  snippets: readonly WMSnippetOption[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return snippets
    return snippets.filter(s =>
      s.token.toLowerCase().includes(q) ||
      s.label.toLowerCase().includes(q) ||
      s.resolvedValue.toLowerCase().includes(q),
    )
  }, [snippets, query])

  useEffect(() => { setActiveIdx(0) }, [query, open])
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  const insert = (s: WMSnippetOption) => {
    editor.commands.insertSnippet({
      token: s.token,
      label: s.label,
      resolvedValue: s.resolvedValue || `{{${s.token}}}`,
    })
    setOpen(false)
    setQuery('')
  }

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[activeIdx]) insert(filtered[activeIdx]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(o => !o)}
        title="Insert snippet"
        aria-label="Insert snippet"
        className={[
          'h-6 inline-flex items-center justify-center gap-0.5 rounded transition-colors px-1.5',
          open
            ? 'bg-wm-accent text-wm-text-on-accent'
            : 'hover:bg-wm-bg-hover text-wm-text-muted hover:text-wm-text',
        ].join(' ')}
      >
        <Braces size={12} />
        <span className="text-[10px] font-semibold">Snippet</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-40 w-80 rounded-md border border-wm-border bg-wm-bg-elevated shadow-xl animate-wm-slide-in-up overflow-hidden">
            <div className="p-2 border-b border-wm-border">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-wm-text-subtle" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Search snippets…"
                  className="w-full h-7 pl-7 pr-2 rounded bg-wm-bg border border-wm-border text-[12px] text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus"
                />
              </div>
            </div>

            <div className="max-h-[280px] overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-wm-text-subtle">
                  {snippets.length === 0
                    ? 'No snippets defined for this project yet.'
                    : `No matches for "${query}"`}
                </div>
              ) : (
                <>
                  {renderSnippetGroup(filtered, 'global', 'Global merge fields', activeIdx, insert)}
                  {renderSnippetGroup(filtered, 'custom', 'Custom snippets', activeIdx, insert)}
                </>
              )}
            </div>

            <div className="px-3 py-1.5 border-t border-wm-border bg-wm-bg flex items-center justify-between text-[10px] text-wm-text-subtle">
              <span>↑↓ navigate · ↵ insert · esc to close</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function renderSnippetGroup(
  all: readonly WMSnippetOption[],
  source: WMSnippetOption['source'],
  label: string,
  activeIdx: number,
  onPick: (s: WMSnippetOption) => void,
) {
  const items = all.filter(s => s.source === source)
  if (items.length === 0) return null
  return (
    <div className="mb-1">
      <p className="px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle">
        {label}
      </p>
      {items.map((s) => {
        const idx = all.indexOf(s)
        const isActive = idx === activeIdx
        return (
          <button
            key={`${s.source}:${s.token}`}
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPick(s)}
            className={[
              'w-full text-left rounded px-2 py-1.5 flex items-start gap-2 transition-colors',
              isActive
                ? 'bg-wm-bg-selected'
                : 'hover:bg-wm-bg-hover',
            ].join(' ')}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-wm-text truncate">{s.label}</p>
              <code className="text-[10px] text-wm-accent-strong">{'{{' + s.token + '}}'}</code>
            </div>
            <span className={[
              'text-[10px] truncate max-w-[100px] mt-0.5',
              s.resolvedValue ? 'text-wm-text-muted italic' : 'text-wm-text-subtle italic opacity-60',
            ].join(' ')}>
              {s.resolvedValue || '(empty)'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function TopButton({
  label, shortcut, active, onClick, children,
}: {
  label: string
  shortcut?: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      title={shortcut ? `${label} · ${shortcut}` : label}
      aria-label={label}
      className={[
        'h-6 w-6 inline-flex items-center justify-center rounded transition-colors',
        active
          ? 'bg-wm-accent text-wm-text-on-accent'
          : 'hover:bg-wm-bg-hover text-wm-text-muted hover:text-wm-text',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function TopDivider() {
  return <div className="w-px h-4 bg-wm-border mx-0.5 shrink-0" />
}

// ── Bubble toolbar (selection-time, dark surface) ─────────────────────

function BubbleToolbarContent({
  editor, headingLevels, singleLine,
}: {
  editor: Editor
  headingLevels: (1 | 2 | 3 | 4 | 5)[]
  singleLine: boolean
}) {
  return (
    <>
      {!singleLine && headingLevels.map(level => {
        const Icon = HEADING_ICONS[level]
        return (
          <BubbleButton
            key={level}
            label={`Heading ${level}`}
            active={editor.isActive('heading', { level })}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          >
            <Icon size={13} />
          </BubbleButton>
        )
      })}
      {!singleLine && headingLevels.length > 0 && <BubbleDivider />}
      <BubbleButton
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={13} />
      </BubbleButton>
      <BubbleButton
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={13} />
      </BubbleButton>
      <BubbleButton
        label="Inline code"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={13} />
      </BubbleButton>
      <BubbleDivider />
      <BubbleButton
        label="Link"
        active={editor.isActive('link')}
        onClick={() => promptLink(editor)}
      >
        <LinkIcon size={13} />
      </BubbleButton>
      {!singleLine && (
        <>
          <BubbleDivider />
          <BubbleButton
            label="Bullet list"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={13} />
          </BubbleButton>
          <BubbleButton
            label="Ordered list"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={13} />
          </BubbleButton>
        </>
      )}
    </>
  )
}

function BubbleButton({
  label, active, onClick, children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'h-7 w-7 inline-flex items-center justify-center rounded-[5px] transition-colors',
        active
          ? 'bg-wm-accent text-wm-text-on-accent'
          : 'hover:bg-wm-text-muted/30 text-wm-bg',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function BubbleDivider() {
  return <div className="w-px h-5 bg-wm-text-muted/30 mx-0.5" />
}

// ── Shared ────────────────────────────────────────────────────────────

const HEADING_ICONS: Record<1 | 2 | 3 | 4 | 5, typeof Heading1> = {
  1: Heading1, 2: Heading2, 3: Heading3, 4: Heading4, 5: Heading5,
}

function promptLink(editor: Editor) {
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run()
    return
  }
  const url = window.prompt('URL')
  if (url) editor.chain().focus().setLink({ href: url }).run()
}
