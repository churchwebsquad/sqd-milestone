/**
 * Grid editor — collapses Brixies wrapper chains like
 *   row_list → item_X
 *   row_list → item_X → card[single_instance]
 * into a single flat "Cards · N" list with a stepper.
 *
 * The Brixies template controls the visual layout (most are a single
 * row of N items); the strategist controls how many cards there are
 * and the per-card slots. Data is written into the first row of the
 * nested structure so the renderer's expandGroup chain produces N
 * cards visually.
 *
 * If the group doesn't have a recognizable wrapper chain, the caller
 * falls back to <GroupEditor>.
 */
import { useMemo, useState } from 'react'
import {
  ChevronDown, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown,
} from 'lucide-react'
import { SlotEditor } from './SlotEditor'
import { GroupEditor } from './GroupEditor'
import type { WMSnippetOption } from '../RichTextEditor'
import type { WebGroupDef, WebFieldDef, WebContentTemplate } from '../../../types/database'

interface Props {
  group: WebGroupDef
  value: unknown
  onChange: (v: unknown) => void
  snippets: readonly WMSnippetOption[]
  cardTemplates?: Record<string, WebContentTemplate>
}

export function GridEditor({ group, value, onChange, snippets, cardTemplates }: Props) {
  const chain = useMemo(() => detectGridChain(group), [group])
  if (!chain) return null

  const rowsArr: Record<string, unknown>[] = Array.isArray(value)
    ? (value as Record<string, unknown>[])
    : []

  // Flatten all items across all rows so the editor reads as a single
  // "cards" list. Internally we write to row[0] only.
  const flatCards: Record<string, unknown>[] = []
  for (const row of rowsArr) {
    const cols = Array.isArray(row[chain.colsKey]) ? row[chain.colsKey] as Record<string, unknown>[] : []
    for (const col of cols) flatCards.push(col)
  }

  // Initial count when there's no data yet — fall back to Brixies'
  // row × col defaults so the strategist starts with the template's
  // intended cell count. Once the user has any data (even 1 cell),
  // respect their count so they can reduce below the default.
  const defaultCount = chain.rowsGroup.default_count * chain.colsGroup.default_count
  const count = flatCards.length > 0
    ? Math.max(flatCards.length, 1)
    : Math.max(defaultCount, 1)

  // Pad flatCards out to `count` with empty slots so the UI shows all
  // expected cells even before the user types.
  const cells: Record<string, unknown>[] = []
  for (let i = 0; i < count; i++) cells.push(flatCards[i] ?? {})

  const writeCells = (next: Record<string, unknown>[]) => {
    // When the cols group is meant to hold ONE cell per row
    // (default_count === 1 — typical of Slide-carousel patterns where
    // each Slide has a single Card), distribute cells as N rows × 1
    // col so the renderer expands the outer group to N siblings. Else
    // pack all cells into a single row's colsKey (the historical path
    // for templates with multiple cells per row).
    if (chain.colsGroup.default_count === 1) {
      onChange(next.map(cell => ({ [chain.colsKey]: [cell] })))
    } else {
      onChange([{ [chain.colsKey]: next }])
    }
  }

  const readSlot = (cell: Record<string, unknown>, key: string): unknown => {
    if (chain.leafKey) {
      const leafArr = Array.isArray(cell[chain.leafKey]) ? cell[chain.leafKey] as Record<string, unknown>[] : []
      return leafArr[0]?.[key]
    }
    return cell[key]
  }

  const writeSlot = (idx: number, key: string, v: unknown) => {
    const next = [...cells]
    const cell = { ...(next[idx] ?? {}) }
    if (chain.leafKey) {
      const leafArr = Array.isArray(cell[chain.leafKey]) ? [...(cell[chain.leafKey] as Record<string, unknown>[])] : []
      const leaf = { ...(leafArr[0] ?? {}), [key]: v }
      leafArr[0] = leaf
      cell[chain.leafKey] = leafArr
    } else {
      cell[key] = v
    }
    next[idx] = cell
    writeCells(next)
  }

  const setCount = (n: number) => {
    const clamped = Math.max(1, Math.min(24, n))
    if (clamped === count) return
    const next = cells.slice(0, clamped)
    while (next.length < clamped) next.push({})
    writeCells(next)
  }

  const removeCell = (idx: number) => {
    if (count <= 1) return
    writeCells(cells.filter((_, i) => i !== idx))
  }

  const moveCell = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= cells.length) return
    const next = [...cells]
    const [taken] = next.splice(idx, 1)
    next.splice(target, 0, taken)
    writeCells(next)
  }

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-wm-border/60">
        <p className="text-[10px] uppercase tracking-[0.08em] font-bold text-wm-accent-strong truncate">
          Cards · {count}
        </p>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCount(count - 1)}
            disabled={count <= 1}
            className="h-6 w-6 grid place-items-center rounded text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Remove last card"
          >
            <span className="text-[13px] leading-none">−</span>
          </button>
          <span className="font-mono tabular-nums text-[12px] text-wm-text w-5 text-center">{count}</span>
          <button
            type="button"
            onClick={() => setCount(count + 1)}
            disabled={count >= 24}
            className="h-6 w-6 grid place-items-center rounded text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Add card"
          >
            <Plus size={11} />
          </button>
        </div>
      </div>

      <ul>
        {cells.map((cell, idx) => (
          <li
            key={idx}
            className={[
              'px-3 py-3',
              idx > 0 ? 'border-t border-wm-border/40' : '',
            ].join(' ')}
          >
            <CardCell
              cell={cell}
              idx={idx}
              total={count}
              leafSchema={chain.leafSchema}
              snippets={snippets}
              cardTemplates={cardTemplates}
              readSlot={(key) => readSlot(cell, key)}
              writeSlot={(key, v) => writeSlot(idx, key, v)}
              onRemove={() => removeCell(idx)}
              onMoveUp={() => moveCell(idx, -1)}
              onMoveDown={() => moveCell(idx, 1)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function CardCell({
  cell, idx, total, leafSchema, snippets, cardTemplates,
  readSlot, writeSlot, onRemove, onMoveUp, onMoveDown,
}: {
  cell: Record<string, unknown>
  idx: number
  total: number
  leafSchema: ReadonlyArray<WebFieldDef>
  snippets: readonly WMSnippetOption[]
  cardTemplates?: Record<string, WebContentTemplate>
  readSlot: (key: string) => unknown
  writeSlot: (key: string, v: unknown) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [open, setOpen] = useState(idx < 2)  // first couple expanded
  const visible = leafSchema.filter(isEditableLeafField)

  return (
    <div>
      <div className="flex items-center gap-1 group/cell">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-accent-strong transition-colors min-w-0"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="font-semibold">Card {idx + 1}</span>
        </button>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/cell:opacity-100 transition-opacity">
          <button type="button" onClick={onMoveUp} disabled={idx === 0}
            className="h-6 w-6 grid place-items-center rounded text-wm-text-subtle hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"><ArrowUp size={11} /></button>
          <button type="button" onClick={onMoveDown} disabled={idx === total - 1}
            className="h-6 w-6 grid place-items-center rounded text-wm-text-subtle hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"><ArrowDown size={11} /></button>
          <button type="button" onClick={onRemove} disabled={total <= 1}
            className="h-6 w-6 grid place-items-center rounded text-wm-text-subtle hover:bg-wm-danger-bg hover:text-wm-danger disabled:opacity-30 disabled:cursor-not-allowed"
            title="Remove card"><Trash2 size={11} /></button>
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-2.5">
          {visible.map((field, i) => {
            if (field.kind === 'slot') {
              return (
                <SlotEditor
                  key={field.key + '-' + i}
                  slot={field}
                  value={readSlot(field.key)}
                  onChange={(v) => writeSlot(field.key, v)}
                  snippets={snippets}
                />
              )
            }
            return (
              <GroupEditor
                key={field.key + '-' + i}
                group={field}
                value={readSlot(field.key)}
                onChange={(v) => writeSlot(field.key, v)}
                snippets={snippets}
                cardTemplates={cardTemplates}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Grid detection ──────────────────────────────────────────────────

export interface GridChain {
  rowsGroup: WebGroupDef
  colsGroup: WebGroupDef
  colsKey: string
  leafKey: string | null
  leafSchema: ReadonlyArray<WebFieldDef>
}

export function detectGridChain(g: WebGroupDef): GridChain | null {
  if (!Array.isArray(g.item_schema) || g.item_schema.length !== 1) return null
  const inner = g.item_schema[0]
  if (inner.kind !== 'group' || !Array.isArray(inner.item_schema)) return null
  const colsGroup = inner

  const hasSlots = colsGroup.item_schema.some(f => f.kind === 'slot')
  if (hasSlots) {
    return {
      rowsGroup: g,
      colsGroup,
      colsKey: colsGroup.key,
      leafKey: null,
      leafSchema: colsGroup.item_schema,
    }
  }

  if (colsGroup.item_schema.length === 1) {
    const innerInner = colsGroup.item_schema[0]
    if (innerInner.kind === 'group' && Array.isArray(innerInner.item_schema)
        && innerInner.item_schema.some(f => f.kind === 'slot')) {
      return {
        rowsGroup: g,
        colsGroup,
        colsKey: colsGroup.key,
        leafKey: innerInner.key,
        leafSchema: innerInner.item_schema,
      }
    }
  }
  return null
}

function isEditableLeafField(field: WebFieldDef): boolean {
  if (field.kind === 'slot') {
    return field.type !== 'image'
  }
  const itemSchema = Array.isArray(field.item_schema) ? field.item_schema : []
  // Image-shaped group (preserve default_count via renderer, hide here).
  const layerLooksImage = /image|photo|picture|graphic|logo/i.test(
    `${field.layer_name ?? ''} ${field.key}`,
  )
  if (itemSchema.length === 0 && layerLooksImage) return false
  // Decorative single-instance empty-schema groups (e.g. `Step`
  // auto-numbered counters) — handled by renderer, hidden here.
  if (itemSchema.length === 0 && field.single_instance_hint) return false
  // Group whose only authored slot(s) are images.
  if (itemSchema.length > 0) {
    const editable = itemSchema.some(f =>
      f.kind === 'slot' ? f.type !== 'image' : true,
    )
    if (!editable) return false
  }
  return true
}
