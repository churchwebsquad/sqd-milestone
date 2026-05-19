/**
 * Repeatable item list editor for a WebGroupDef.
 *
 * Items render as a stacked list (no left-border indent). Each item
 * is a small card surface with a header (Card/Row/Button N + actions)
 * and an expandable body with the item's slots.
 *
 * Image slots inside item_schema are hidden — at this stage we just
 * count image placeholders. Card icon slots are image-typed, so this
 * naturally hides them.
 */
import { useState } from 'react'
import {
  ChevronDown, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown,
} from 'lucide-react'
import { SlotEditor } from './SlotEditor'
import type { WMSnippetOption } from '../RichTextEditor'
import type { WebGroupDef, WebFieldDef } from '../../../types/database'

interface Props {
  group: WebGroupDef
  value: unknown
  onChange: (v: unknown) => void
  snippets: readonly WMSnippetOption[]
  depth?: number
}

export function GroupEditor({ group, value, onChange, snippets, depth = 0 }: Props) {
  const items: Record<string, unknown>[] = Array.isArray(value)
    ? (value as Record<string, unknown>[])
    : []

  // Items added by the user this session start expanded. Items loaded
  // from existing field_values start collapsed unless they're the only
  // one.
  const [expanded, setExpanded] = useState<Set<number>>(() =>
    items.length === 1 ? new Set([0]) : new Set(),
  )

  const semantics = groupSemantics(group)
  const groupTitle = semantics.groupTitle

  const setItem = (idx: number, patch: Record<string, unknown>) => {
    const next = [...items]
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }

  const addItem = () => {
    const newIdx = items.length
    onChange([...items, makeEmptyItem(group.item_schema)])
    setExpanded(prev => {
      const next = new Set(prev)
      next.add(newIdx)
      return next
    })
  }

  const removeItem = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx))
    setExpanded(prev => {
      const next = new Set<number>()
      // Shift indices down for items after the removed one.
      for (const i of prev) {
        if (i < idx) next.add(i)
        else if (i > idx) next.add(i - 1)
      }
      return next
    })
  }

  const moveItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [taken] = next.splice(idx, 1)
    next.splice(target, 0, taken)
    onChange(next)
    // Swap expansion state between idx and target.
    setExpanded(prev => {
      const set = new Set(prev)
      const had = set.has(idx)
      const tar = set.has(target)
      if (had) set.delete(idx); else set.delete(idx)
      if (tar) set.delete(target); else set.delete(target)
      if (had) set.add(target)
      if (tar) set.add(idx)
      return set
    })
  }

  const toggleExpanded = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  // Tone — body/CTA/card groups get different headers.
  const headerTone =
    semantics.kind === 'cta' ? 'text-emerald-700'
    : 'text-wm-accent-strong'

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-wm-border/60">
        <p className={[
          'text-[10px] uppercase tracking-[0.08em] font-bold truncate',
          headerTone,
        ].join(' ')}>
          {groupTitle}{items.length > 0 ? ` · ${items.length}` : ''}
        </p>
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30 hover:bg-wm-accent/15 transition-colors"
        >
          <Plus size={11} />
          {semantics.addLabel}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-wm-text-subtle italic">
          {semantics.emptyHint}
        </p>
      ) : (
        <ul>
          {items.map((item, idx) => (
            <li
              key={idx}
              className={[
                'px-3 py-2',
                idx > 0 ? 'border-t border-wm-border/40' : '',
              ].join(' ')}
            >
              <ItemCard
                item={item}
                idx={idx}
                total={items.length}
                schema={group.item_schema}
                semantics={semantics}
                snippets={snippets}
                depth={depth + 1}
                isOpen={expanded.has(idx)}
                onToggle={() => toggleExpanded(idx)}
                onPatch={(patch) => setItem(idx, patch)}
                onRemove={() => removeItem(idx)}
                onMoveUp={() => moveItem(idx, -1)}
                onMoveDown={() => moveItem(idx, 1)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ItemCard({
  item, idx, total, schema, semantics, snippets, depth, isOpen,
  onToggle, onPatch, onRemove, onMoveUp, onMoveDown,
}: {
  item: Record<string, unknown>
  idx: number
  total: number
  schema: WebFieldDef[]
  semantics: GroupSemantics
  snippets: readonly WMSnippetOption[]
  depth: number
  isOpen: boolean
  onToggle: () => void
  onPatch: (patch: Record<string, unknown>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const preview = buildItemPreview(item, schema)
  const itemLabel = `${semantics.itemLabel} ${idx + 1}`
  const visibleSchema = schema.filter(isEditableSchemaField)

  return (
    <div>
      <div className="flex items-center gap-1 group/item">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-accent-strong transition-colors min-w-0"
        >
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="font-semibold">{itemLabel}</span>
          {!isOpen && preview && (
            <span className="text-wm-text-subtle font-normal truncate max-w-[220px]">— {preview}</span>
          )}
        </button>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
          <IconButton title="Move up" onClick={onMoveUp} disabled={idx === 0}>
            <ArrowUp size={11} />
          </IconButton>
          <IconButton title="Move down" onClick={onMoveDown} disabled={idx === total - 1}>
            <ArrowDown size={11} />
          </IconButton>
          <IconButton title={`Remove ${semantics.itemLabel.toLowerCase()}`} onClick={onRemove} destructive>
            <Trash2 size={11} />
          </IconButton>
        </div>
      </div>
      {isOpen && (
        <div className="mt-2 space-y-2.5">
          {visibleSchema.map((field, i) => {
            if (field.kind === 'slot') {
              return (
                <SlotEditor
                  key={field.key + '-' + i}
                  slot={field}
                  value={item[field.key]}
                  onChange={(v) => onPatch({ [field.key]: v })}
                  snippets={snippets}
                  depth={depth}
                />
              )
            }
            return (
              <GroupEditor
                key={field.key + '-' + i}
                group={field}
                value={item[field.key]}
                onChange={(v) => onPatch({ [field.key]: v })}
                snippets={snippets}
                depth={depth}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function IconButton({
  children, title, onClick, disabled, destructive,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={[
        'h-6 w-6 grid place-items-center rounded text-wm-text-subtle transition-colors',
        destructive ? 'hover:bg-wm-danger-bg hover:text-wm-danger'
        : 'hover:bg-wm-bg-hover hover:text-wm-text',
        'disabled:opacity-30 disabled:cursor-not-allowed',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── Semantic naming ────────────────────────────────────────────────

interface GroupSemantics {
  kind: 'cta' | 'card' | 'row' | 'step' | 'faq' | 'item'
  groupTitle: string
  itemLabel: string
  addLabel: string
  emptyHint: string
}

function groupSemantics(group: WebGroupDef): GroupSemantics {
  const c = group.key.toLowerCase().replace(/[_\s-]+/g, '')
  const groupTitleBase = group.key.replace(/_/g, ' ').toUpperCase()

  if (c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')) {
    return {
      kind: 'cta',
      groupTitle: 'Buttons',
      itemLabel: 'Button',
      addLabel: 'Add button',
      emptyHint: 'No buttons yet — click "Add button".',
    }
  }
  if (c.includes('step') || c.includes('process')) {
    return {
      kind: 'step',
      groupTitle: 'Steps',
      itemLabel: 'Step',
      addLabel: 'Add step',
      emptyHint: 'No steps yet — click "Add step".',
    }
  }
  if (c.includes('faq') || c.includes('accordion') || c.includes('question')) {
    return {
      kind: 'faq',
      groupTitle: 'FAQs',
      itemLabel: 'FAQ',
      addLabel: 'Add FAQ',
      emptyHint: 'No FAQs yet — click "Add FAQ".',
    }
  }
  if (c.includes('row') || c === 'rowlist' || c === 'rows') {
    return {
      kind: 'row',
      groupTitle: 'Rows',
      itemLabel: 'Row',
      addLabel: 'Add row',
      emptyHint: 'No rows yet — click "Add row".',
    }
  }
  if (c.includes('card') || c === 'items' || c === 'features'
      || c === 'tiles' || c === 'blocks' || c === 'list'
      || c === 'pillars' || c === 'tiers' || c === 'programs'
      || c === 'members' || c === 'groups' || c === 'classes'
      || c === 'events' || c === 'doctrines' || c === 'values') {
    return {
      kind: 'card',
      groupTitle: c.includes('card') ? 'Cards' : groupTitleBase,
      itemLabel: 'Card',
      addLabel: 'Add card',
      emptyHint: 'No cards yet — click "Add card".',
    }
  }
  return {
    kind: 'item',
    groupTitle: groupTitleBase,
    itemLabel: 'Item',
    addLabel: 'Add item',
    emptyHint: 'No items yet — click "Add item".',
  }
}

// ── Item schema filtering ───────────────────────────────────────────

/** Drop image slots from nested item_schema rendering — at this stage
 *  we don't author images here (icons/photos count via the bottom-of-
 *  panel counter). */
function isEditableSchemaField(field: WebFieldDef): boolean {
  if (field.kind === 'slot' && field.type === 'image') return false
  return true
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeEmptyItem(schema: WebFieldDef[]): Record<string, unknown> {
  const item: Record<string, unknown> = {}
  for (const f of schema) {
    if (f.kind === 'slot') {
      if (f.type === 'cta') item[f.key] = { label: '', url: '' }
      else if (f.type === 'boolean') item[f.key] = false
      else item[f.key] = ''
    } else {
      item[f.key] = []
    }
  }
  return item
}

function buildItemPreview(item: Record<string, unknown>, schema: WebFieldDef[]): string {
  for (const f of schema) {
    if (f.kind !== 'slot') continue
    const v = item[f.key]
    if (typeof v === 'string' && v.trim()) {
      return stripTags(v).slice(0, 80)
    }
    if (f.type === 'cta' && typeof v === 'object' && v !== null) {
      const label = (v as { label?: string }).label
      if (label) return label
    }
  }
  return ''
}

function stripTags(html: string): string {
  if (typeof document === 'undefined') return html
  const d = document.createElement('div')
  d.innerHTML = html
  return (d.textContent ?? '').replace(/\s+/g, ' ').trim()
}
