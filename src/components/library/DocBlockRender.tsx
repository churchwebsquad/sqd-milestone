/**
 * Shared Notion-block renderer — used by the doc detail page and the
 * Action Item detail page. Covers the common block types a Notion author
 * actually uses: paragraphs, headings, lists, callouts, quotes, code,
 * dividers, images, plus the recently-added to_do (checklist), toggle,
 * bookmarks, embeds/video/link previews, and tables.
 *
 * Inline formatting (bold/italic/links/code) comes through as the
 * markdown-ish string the edge function emits via `richTextToMarkdown`.
 *
 * In-app editing: when `editable` is on, text-bearing blocks
 * (paragraph/heading/list/to_do/quote/callout/toggle) gain a hover
 * pencil + trash overlay. Click pencil → swap to a textarea, save on
 * blur or Cmd+Enter, fires `onEdit(blockId, type, newText)`. Trash fires
 * `onArchive(blockId)` after a confirm. Tables, embeds, images, code,
 * dividers stay read-only — those still route to Notion via the "Open
 * in Notion" link in the doc header.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import type { DocBlock } from '../../types/strategy'
import type { EditableBlockType } from '../../lib/strategyNotion'

const EDITABLE_TYPES: ReadonlySet<DocBlock['type']> = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'bulleted_list_item', 'numbered_list_item',
  'to_do', 'toggle', 'quote', 'callout',
])

interface DocBlocksProps {
  blocks: DocBlock[]
  /** When true, hover-edit/trash affordances appear on text-bearing blocks. */
  editable?: boolean
  onEdit?: (blockId: string, type: EditableBlockType, text: string) => Promise<void>
  onArchive?: (blockId: string) => Promise<void>
}

export function DocBlocks({ blocks, editable, onEdit, onArchive }: DocBlocksProps) {
  if (blocks.length === 0) return null

  // Group consecutive list items into <ul>/<ol>; group consecutive to_do
  // items so the checklist reads as a single visual block.
  const out: ReactNode[] = []
  let runType: 'bulleted' | 'numbered' | 'todo' | null = null
  let runItems: DocBlock[] = []

  const flush = () => {
    if (runItems.length === 0) return
    if (runType === 'todo') {
      out.push(
        <div key={`run-${out.length}`} className="my-3 space-y-1.5">
          {runItems.map((b, i) => (
            <EditableShell
              key={b.id ?? i}
              block={b}
              editable={editable}
              onEdit={onEdit}
              onArchive={onArchive}
            >
              {(text, editingNode) => (
                <div className="flex items-start gap-2.5">
                  <span
                    className={[
                      'mt-1 w-3.5 h-3.5 rounded-sm border-2 grid place-items-center shrink-0',
                      b.meta?.checked
                        ? 'bg-[var(--color-status-launched)] border-[var(--color-status-launched)] text-white'
                        : 'border-[var(--color-lib-border-strong)] bg-white',
                    ].join(' ')}
                  >
                    {b.meta?.checked && <span className="text-[8px] leading-none">✓</span>}
                  </span>
                  <span className={editingNode ? 'flex-1' : (b.meta?.checked ? 'line-through opacity-60 flex-1' : 'flex-1')}>
                    {editingNode ?? <Inline text={text} />}
                  </span>
                </div>
              )}
            </EditableShell>
          ))}
        </div>,
      )
    } else {
      const Tag = runType === 'numbered' ? 'ol' : 'ul'
      const cls = runType === 'numbered' ? 'list-decimal' : 'list-disc'
      out.push(
        <Tag key={`run-${out.length}`} className={`${cls} pl-6 mb-3 space-y-2`}>
          {runItems.map((b, i) => (
            <li key={b.id ?? i}>
              <EditableShell
                block={b}
                editable={editable}
                onEdit={onEdit}
                onArchive={onArchive}
              >
                {(text, editingNode) => (
                  <>
                    {editingNode ?? <Inline text={text} />}
                    {b.children && b.children.length > 0 && !editingNode && (
                      <DocBlocks blocks={b.children} editable={editable} onEdit={onEdit} onArchive={onArchive} />
                    )}
                  </>
                )}
              </EditableShell>
            </li>
          ))}
        </Tag>,
      )
    }
    runType = null
    runItems = []
  }

  for (const b of blocks) {
    const t: 'bulleted' | 'numbered' | 'todo' | null =
      b.type === 'bulleted_list_item' ? 'bulleted'
      : b.type === 'numbered_list_item' ? 'numbered'
      : b.type === 'to_do' ? 'todo'
      : null
    if (t) {
      if (runType !== t) flush()
      runType = t
      runItems.push(b)
      continue
    }
    flush()
    out.push(
      <Block
        key={b.id ?? out.length}
        block={b}
        editable={editable}
        onEdit={onEdit}
        onArchive={onArchive}
      />,
    )
  }
  flush()

  return <div className="text-base leading-relaxed text-[var(--color-lib-text)]">{out}</div>
}

interface BlockProps {
  block: DocBlock
  editable?: boolean
  onEdit?: (blockId: string, type: EditableBlockType, text: string) => Promise<void>
  onArchive?: (blockId: string) => Promise<void>
}

function Block({ block, editable, onEdit, onArchive }: BlockProps) {
  switch (block.type) {
    case 'heading_1':
      return (
        <EditableShell block={block} editable={editable} onEdit={onEdit} onArchive={onArchive}>
          {(text, editingNode) => (
            <h2 className="text-xl font-semibold tracking-tight mt-6 mb-3">
              {editingNode ?? <Inline text={text} />}
            </h2>
          )}
        </EditableShell>
      )
    case 'heading_2':
      return (
        <EditableShell block={block} editable={editable} onEdit={onEdit} onArchive={onArchive}>
          {(text, editingNode) => (
            <h3 className="text-lg font-semibold mt-5 mb-2">
              {editingNode ?? <Inline text={text} />}
            </h3>
          )}
        </EditableShell>
      )
    case 'heading_3':
      return (
        <EditableShell block={block} editable={editable} onEdit={onEdit} onArchive={onArchive}>
          {(text, editingNode) => (
            <h4 className="text-base font-semibold mt-4 mb-2">
              {editingNode ?? <Inline text={text} />}
            </h4>
          )}
        </EditableShell>
      )
    case 'paragraph':
      if (!block.text && !editable) return <div className="h-3" />
      return (
        <EditableShell block={block} editable={editable} onEdit={onEdit} onArchive={onArchive}>
          {(text, editingNode) => (
            <p className="mb-3">{editingNode ?? (text ? <Inline text={text} /> : <span className="text-[var(--color-lib-text-subtle)] italic">Empty paragraph</span>)}</p>
          )}
        </EditableShell>
      )
    case 'callout':
      return (
        <EditableShell block={block} editable={editable} onEdit={onEdit} onArchive={onArchive}>
          {(text, editingNode) => (
            <div className="rounded-md border-l-[3px] border-[var(--color-lib-accent)] bg-[var(--color-lib-accent-soft)] px-4 py-3 my-4 italic flex gap-3 items-start">
              {block.meta?.emoji && <span className="not-italic">{block.meta.emoji}</span>}
              <div className="flex-1">
                {editingNode ?? <Inline text={text} />}
                {block.children && block.children.length > 0 && !editingNode && (
                  <div className="mt-2 not-italic">
                    <DocBlocks blocks={block.children} editable={editable} onEdit={onEdit} onArchive={onArchive} />
                  </div>
                )}
              </div>
            </div>
          )}
        </EditableShell>
      )
    case 'quote':
      return (
        <EditableShell block={block} editable={editable} onEdit={onEdit} onArchive={onArchive}>
          {(text, editingNode) => (
            <blockquote className="border-l-[3px] border-[var(--color-lib-accent)] bg-[var(--color-lib-accent-soft)] px-4 py-3 my-4 italic">
              {editingNode ?? <Inline text={text} />}
            </blockquote>
          )}
        </EditableShell>
      )
    case 'code':
      return (
        <pre className="bg-[var(--color-lib-bg)] border border-[var(--color-lib-border)] rounded-sm p-3 my-3 overflow-x-auto text-xs font-mono">
          {block.text}
        </pre>
      )
    case 'divider':
      return <hr className="border-t border-[var(--color-lib-border)] my-5" />
    case 'image':
      return block.url
        ? <img src={block.url} alt="" className="rounded-sm my-4 max-w-full" />
        : null
    case 'toggle':
      return (
        <EditableShell block={block} editable={editable} onEdit={onEdit} onArchive={onArchive}>
          {(text, editingNode) => (
            <details className="my-3 group/toggle rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] open:bg-[var(--color-lib-bg)]">
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-[var(--color-lib-text)] list-none [&::-webkit-details-marker]:hidden">
                <ChevronDown size={14} className="text-[var(--color-lib-text-subtle)] transition-transform group-open/toggle:rotate-0 -rotate-90" />
                <span className="flex-1">{editingNode ?? <Inline text={text} />}</span>
              </summary>
              {block.children && block.children.length > 0 && !editingNode && (
                <div className="px-3 pb-3 pl-9">
                  <DocBlocks blocks={block.children} editable={editable} onEdit={onEdit} onArchive={onArchive} />
                </div>
              )}
            </details>
          )}
        </EditableShell>
      )
    case 'bookmark':
    case 'link_preview':
      return block.url ? (
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          className="my-3 flex items-center gap-3 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] px-4 py-3 hover:border-[var(--color-lib-border-strong)]"
        >
          <ExternalLink size={14} className="text-[var(--color-lib-text-subtle)] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-[var(--color-lib-text)] truncate">
              {block.meta?.caption || hostnameOf(block.url)}
            </div>
            <div className="text-[11px] text-[var(--color-lib-text-subtle)] truncate">
              {block.url}
            </div>
          </div>
        </a>
      ) : null
    case 'embed':
    case 'video':
      return block.url ? (
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          className="my-3 flex items-center gap-3 rounded-md border border-dashed border-[var(--color-lib-border-strong)] bg-[var(--color-lib-bg)] px-4 py-3 hover:border-[var(--color-lib-accent)] hover:bg-[var(--color-lib-accent-soft)]"
        >
          <ExternalLink size={14} className="text-[var(--color-lib-text-subtle)] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-lib-text-subtle)] font-semibold">
              {block.type === 'video' ? 'Video' : 'Embed'}
            </div>
            <div className="text-sm text-[var(--color-lib-text)] truncate">{block.url}</div>
          </div>
        </a>
      ) : null
    case 'table': {
      const rows = block.children ?? []
      if (rows.length === 0) return null
      return (
        <div className="my-4 overflow-x-auto rounded-md border border-[var(--color-lib-border)]">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-[var(--color-lib-border)] last:border-b-0">
                  {(row.cells ?? []).map((cell, ci) => {
                    const isHeader = (block.meta?.columnHeader && ri === 0) ||
                      (block.meta?.rowHeader && ci === 0)
                    const Tag = isHeader ? 'th' : 'td'
                    return (
                      <Tag
                        key={ci}
                        className={[
                          'px-3 py-2 align-top border-r border-[var(--color-lib-border)] last:border-r-0',
                          isHeader
                            ? 'bg-[var(--color-lib-bg)] font-semibold text-left text-[var(--color-lib-text)]'
                            : 'text-[var(--color-lib-text)]',
                        ].join(' ')}
                      >
                        <Inline text={cell} />
                      </Tag>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'table_row':
      // Already rendered by the parent `table` block. Standalone rows are
      // rare but treat as a no-op rather than spitting "[table_row]".
      return null
    case 'container': {
      // Transparent wrapper for column_list / column / synced_block.
      // Render children inline using the same DocBlocks pipeline so any
      // grouping (consecutive list items, etc.) still applies inside
      // the column. Multi-column layouts get a flex row; synced /
      // generic containers just pass through as a vertical stack.
      const kids = block.children ?? []
      if (kids.length === 0) return null
      return (
        <DocBlocks
          blocks={kids}
          editable={editable}
          onEdit={onEdit}
          onArchive={onArchive}
        />
      )
    }
    case 'child_page': {
      // Notion subpage. We don't inline-flatten its tree — show a card
      // that links out to Notion so authors can still navigate in.
      const url = `https://www.notion.so/${(block.id ?? '').replace(/-/g, '')}`
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block my-2 rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] px-4 py-3 hover:border-[var(--color-lib-accent)] hover:bg-[var(--color-lib-accent-soft)] transition-colors"
        >
          <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] block mb-0.5">
            Subpage
          </span>
          <span className="text-sm font-semibold text-[var(--color-lib-text)] inline-flex items-center gap-1">
            {block.text || 'Untitled subpage'}
            <ExternalLink size={11} />
          </span>
        </a>
      )
    }
    case 'unsupported':
      return null  // hide unsupported blocks rather than showing "[child_database]"
    default:
      return null
  }
}

/** Wrapper around any text-bearing block that adds a hover pencil + trash
 *  overlay when `editable` is on, and swaps in a textarea when the user
 *  clicks the pencil. The render-prop pattern lets each block type keep
 *  its own visual styling while sharing the edit affordance + state. */
function EditableShell({
  block,
  editable,
  onEdit,
  onArchive,
  children,
}: {
  block: DocBlock
  editable?: boolean
  onEdit?: (blockId: string, type: EditableBlockType, text: string) => Promise<void>
  onArchive?: (blockId: string) => Promise<void>
  /** Render-prop. `text` is always a string (the block's current text);
   *  `editingNode` is the textarea ReactNode when in edit mode, or
   *  `null` otherwise. Caller does `editingNode ?? <Inline text={text}/>`
   *  so the textarea visually replaces the rendered content. Splitting
   *  the params (vs. a `ReactNode | string` union) lets callers compose
   *  `<Inline text={text}/>` without TS narrowing complaints. */
  children: (text: string, editingNode: ReactNode | null) => ReactNode
}) {
  const canEdit = !!editable && !!block.id && !!onEdit && EDITABLE_TYPES.has(block.type)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(block.text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // Keep the draft synced if the source text changes from outside (e.g.
  // a re-fetch after save replaces the block). Avoid clobbering an
  // in-flight edit.
  useEffect(() => {
    if (!editing) setDraft(block.text)
  }, [block.text, editing])

  // Auto-grow + focus when entering edit mode.
  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus()
      taRef.current.setSelectionRange(taRef.current.value.length, taRef.current.value.length)
      taRef.current.style.height = 'auto'
      taRef.current.style.height = taRef.current.scrollHeight + 'px'
    }
  }, [editing])

  if (!canEdit) {
    return <>{children(block.text, null)}</>
  }

  const save = async () => {
    if (!onEdit || !block.id) return
    if (draft === block.text) { setEditing(false); return }
    setSaving(true)
    setError(null)
    try {
      await onEdit(block.id, block.type as EditableBlockType, draft)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setDraft(block.text)
    setEditing(false)
    setError(null)
  }

  const handleArchive = async () => {
    if (!onArchive || !block.id) return
    if (!confirm('Delete this block? This archives it in Notion (recoverable from Notion\'s page history).')) return
    setSaving(true)
    setError(null)
    try {
      await onArchive(block.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  if (editing) {
    const ta = (
      <textarea
        ref={taRef}
        value={draft}
        onChange={e => {
          setDraft(e.target.value)
          if (taRef.current) {
            taRef.current.style.height = 'auto'
            taRef.current.style.height = taRef.current.scrollHeight + 'px'
          }
        }}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save() }
          if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        disabled={saving}
        rows={1}
        className="w-full resize-none border border-[var(--color-lib-accent)] bg-white rounded-sm px-2 py-1 outline-none focus:ring-1 focus:ring-[var(--color-lib-accent)] text-base font-[inherit] leading-[inherit]"
      />
    )
    return (
      <div className="relative group/edit">
        {children(draft, ta)}
        <div className="flex items-center gap-2 mt-1 text-[11px]">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-sm bg-[var(--color-lib-accent)] text-white font-medium px-2 py-0.5 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white px-2 py-0.5 text-[var(--color-lib-text-muted)]"
          >
            Cancel
          </button>
          <span className="text-[var(--color-lib-text-subtle)]">⌘↵ to save · esc to cancel</span>
          {error && <span className="text-red-600">{error}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="relative group/edit">
      {children(block.text, null)}
      <div className="absolute top-0 right-0 hidden group-hover/edit:flex items-center gap-1 bg-white border border-[var(--color-lib-border)] rounded-sm shadow-sm px-1 py-0.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit"
          className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-accent)] p-0.5"
        >
          <Pencil size={12} />
        </button>
        {onArchive && (
          <button
            type="button"
            onClick={handleArchive}
            title="Delete"
            disabled={saving}
            className="text-[var(--color-lib-text-subtle)] hover:text-red-500 p-0.5 disabled:opacity-50"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/** Inline text renderer — handles the markdown-ish output from
 *  `richTextToMarkdown` (bold/italic/links/code) without pulling in a
 *  full markdown parser. */
function Inline({ text }: { text: string }) {
  return <>{renderInline(text)}</>
}

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(_([^_]+)_)|(`([^`]+)`)/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index))
    if (m[1]) {
      out.push(
        <a key={out.length} href={m[3]} target="_blank" rel="noopener noreferrer"
          className="text-[var(--color-lib-accent)] hover:underline">
          {m[2]}
        </a>,
      )
    } else if (m[4]) {
      out.push(<strong key={out.length} className="font-semibold">{m[5]}</strong>)
    } else if (m[6]) {
      out.push(<em key={out.length}>{m[7]}</em>)
    } else if (m[8]) {
      out.push(
        <code key={out.length} className="text-sm bg-[var(--color-lib-bg)] border border-[var(--color-lib-border)] rounded-sm px-1 font-mono">
          {m[9]}
        </code>,
      )
    }
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex))
  return out
}
