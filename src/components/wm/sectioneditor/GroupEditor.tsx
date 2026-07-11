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
  ChevronDown, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown, Check, Clipboard,
} from 'lucide-react'
import { SlotEditor } from './SlotEditor'
import type { SlotAiContext } from './SlotEditor'
import type { WMSnippetOption } from '../RichTextEditor'
import type { WebGroupDef, WebFieldDef, WebContentTemplate } from '../../../types/database'
import { useSectionClipboard } from './SectionClipboard'
import { mapToTargetItem, describeMapping } from './sectionClipboardMapper'

interface Props {
  group: WebGroupDef
  value: unknown
  onChange: (v: unknown) => void
  snippets: readonly WMSnippetOption[]
  depth?: number
  /** Card-family templates for palette-referenced groups. */
  cardTemplates?: Record<string, WebContentTemplate>
  /** AI-suggest grounding — passed through to nested SlotEditors. */
  aiContext?: SlotAiContext
  /** Dotted path from section root to this group's value. Defaults to
   *  group.key when omitted (top-level). Each item's nested slots
   *  receive `${fieldPath}.${idx}.${slot.key}` so partner flags key
   *  correctly by item index (e.g. 'buttons.2.url'). */
  fieldPath?: string
}

export function GroupEditor({ group, value, onChange, snippets, depth = 0, cardTemplates, aiContext, fieldPath }: Props) {
  const basePath = fieldPath ?? group.key
  // Palette-referenced groups (item_template_ref): the user picks
  // which Card template renders each item; items use the SELECTED
  // Card's fields as their item_schema.
  if (group.item_template_ref) {
    return (
      <PaletteGroupEditor
        group={group}
        value={value}
        onChange={onChange}
        snippets={snippets}
        depth={depth}
        cardTemplates={cardTemplates ?? {}}
        basePath={basePath}
      />
    )
  }
  const itemSchema = Array.isArray(group.item_schema) ? group.item_schema : []
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
    onChange([...items, makeEmptyItem(itemSchema)])
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

  // Brixies marks some groups as `single_instance_hint: true` — these
  // are conceptually one-of (e.g. a card group with default_count=1)
  // and shouldn't expose Add/Remove. The strategist edits the single
  // item's fields.
  const isFixed = group.single_instance_hint === true

  // Image-shaped groups (Image, Photo, Picture, Graphic, Logo) suppress
  // ONLY the Add button — count is fixed by the layout's source HTML
  // (Hero 37 ships 2 image frames, Hero 44 ships 3). The strategist
  // still sees and edits each image's text labels, but can't grow the
  // count past what the layout supports. Doesn't trigger isFixed's
  // single-item unwrap — multi-image groups still iterate all items.
  const isImageShapedGroup = /image|photo|picture|graphic|logo/i.test(
    `${group.layer_name ?? ''} ${group.key}`,
  )
  const suppressAdd = isFixed || isImageShapedGroup

  // Section clipboard — when the strategist has copied another
  // section's content, surface a "Paste from clipboard" button next
  // to "Add item". Only when the group can accept items AND the
  // group's item_schema isn't empty (we need slots to map values into).
  const { clipboard, notePaste } = useSectionClipboard()
  const canPaste = !suppressAdd
    && itemSchema.length > 0
    && clipboard !== null
    && clipboard.sourceFieldValues != null
  // Compute the planned mapping so we can show a tooltip with the
  // slot targets the strategist is about to fill.
  const plannedMapping = canPaste && clipboard
    ? describeMapping(clipboard.sourceFieldValues, clipboard.sourceTemplateFields, itemSchema as WebFieldDef[])
    : []
  const pasteFromClipboard = () => {
    if (!clipboard) return
    const newItem = mapToTargetItem(
      clipboard.sourceFieldValues,
      clipboard.sourceTemplateFields,
      itemSchema as WebFieldDef[],
    )
    const newIdx = items.length
    onChange([...items, newItem])
    setExpanded(prev => {
      const next = new Set(prev)
      next.add(newIdx)
      return next
    })
    // Signal the workspace to surface the "archive source?" confirm.
    notePaste({
      sourceSectionId: clipboard.sourceSectionId,
      sourceLayerName: clipboard.sourceLayerName,
      targetSummary:   `${groupTitle} #${newIdx + 1}`,
    })
  }

  // For fixed (single-instance) groups, unwrap: render the one item's
  // fields directly without the group's card/header. Without this the
  // user sees a "No items yet — click Add item" hint that has no Add
  // button (because isFixed hides it), leaving them with no way to
  // edit the underlying fields. Auto-populating with a single empty
  // item lets nested editing flow through.
  if (isFixed) {
    const single = items[0] ?? {}
    const setField = (key: string, v: unknown) => {
      onChange([{ ...single, [key]: v }])
    }
    const visibleSchema = itemSchema.filter(isEditableSchemaField)
    if (visibleSchema.length === 0) return null
    return (
      <div className="space-y-2.5">
        {visibleSchema.map((field, i) => (
          field.kind === 'slot' ? (
            <SlotEditor
              key={field.key + '-' + i}
              slot={field}
              value={single[field.key]}
              onChange={(v) => setField(field.key, v)}
              snippets={snippets}
              aiContext={aiContext}
              fieldPath={`${basePath}.0.${field.key}`}
            />
          ) : (
            <GroupEditor
              key={field.key + '-' + i}
              group={field}
              value={single[field.key]}
              onChange={(v) => setField(field.key, v)}
              snippets={snippets}
              depth={depth + 1}
              aiContext={aiContext}
              cardTemplates={cardTemplates}
              fieldPath={`${basePath}.0.${field.key}`}
            />
          )
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-wm-border/60">
        <p className={[
          'text-[10px] uppercase tracking-[0.08em] font-bold truncate',
          headerTone,
        ].join(' ')}>
          {groupTitle}{items.length > 0 ? ` · ${items.length}` : ''}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {canPaste && (
            <button
              type="button"
              onClick={pasteFromClipboard}
              title={
                plannedMapping.length > 0
                  ? `Paste "${clipboard?.sourceLayerName}" — fills: ${plannedMapping.map(m => m.targetLabel).join(', ')}`
                  : `Paste "${clipboard?.sourceLayerName}"`
              }
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 transition-colors"
            >
              <Clipboard size={11} />
              Paste from clipboard
            </button>
          )}
          {!suppressAdd && (
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30 hover:bg-wm-accent/15 transition-colors"
            >
              <Plus size={11} />
              {semantics.addLabel}
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-wm-text-subtle italic">
          {semantics.emptyHint}
        </p>
      ) : isSingleSlotList(group) ? (
        <ul className="px-3 py-2 space-y-1.5">
          {items.map((item, idx) => (
            <FlatListRow
              key={idx}
              idx={idx}
              total={items.length}
              schema={itemSchema}
              semantics={semantics}
              snippets={snippets}
              item={item}
              onPatch={(patch) => setItem(idx, patch)}
              onRemove={() => removeItem(idx)}
              basePath={basePath}
            />
          ))}
        </ul>
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
                schema={itemSchema}
                semantics={semantics}
                snippets={snippets}
                depth={depth + 1}
                isOpen={expanded.has(idx)}
                onToggle={() => toggleExpanded(idx)}
                onPatch={(patch) => setItem(idx, patch)}
                onRemove={() => removeItem(idx)}
                onMoveUp={() => moveItem(idx, -1)}
                onMoveDown={() => moveItem(idx, 1)}
                cardTemplates={cardTemplates}
                basePath={basePath}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Palette group editor ───────────────────────────────────────────
//
// For groups with `item_template_ref: "from_palette"`. The user picks
// a Card-family template; each item is edited against that template's
// `fields` schema. Storage shape on the section's field_values:
//   { __palette_template_id: string, items: [{...}, {...}] }
// Backward-compatible read: a plain array is treated as `items` and
// the schema's default `referenced_template_id` is used.

interface PaletteValue {
  __palette_template_id?: string
  items?: Array<Record<string, unknown>>
}

function readPaletteValue(value: unknown, defaultId?: string): { templateId: string | undefined; items: Array<Record<string, unknown>> } {
  if (Array.isArray(value)) {
    return { templateId: defaultId, items: value as Array<Record<string, unknown>> }
  }
  if (value && typeof value === 'object') {
    const v = value as PaletteValue
    return {
      templateId: v.__palette_template_id ?? defaultId,
      items: Array.isArray(v.items) ? v.items : [],
    }
  }
  return { templateId: defaultId, items: [] }
}

function PaletteGroupEditor({
  group, value, onChange, snippets, depth, cardTemplates, basePath,
}: {
  group: WebGroupDef
  value: unknown
  onChange: (v: unknown) => void
  snippets: readonly WMSnippetOption[]
  depth: number
  cardTemplates: Record<string, WebContentTemplate>
  basePath?: string
}) {
  const { templateId, items } = readPaletteValue(value, group.referenced_template_id)
  const selectedCard = templateId ? cardTemplates[templateId] : null
  const cardSchema: WebFieldDef[] = Array.isArray(selectedCard?.fields) ? (selectedCard?.fields as WebFieldDef[]) : []

  const writePalette = (nextItems: Array<Record<string, unknown>>, nextTemplateId?: string) => {
    onChange({
      __palette_template_id: nextTemplateId ?? templateId,
      items: nextItems,
    })
  }

  const onPickTemplate = (id: string) => {
    writePalette(items, id)
  }

  const setItem = (idx: number, patch: Record<string, unknown>) => {
    const next = [...items]
    next[idx] = { ...next[idx], ...patch }
    writePalette(next)
  }
  const addItem = () => writePalette([...items, {}])
  const removeItem = (idx: number) => writePalette(items.filter((_, i) => i !== idx))

  const cardList = Object.values(cardTemplates)
    .filter(t => (group.referenced_family ? t.family === group.referenced_family : true))
    .sort((a, b) => (a.layer_name ?? '').localeCompare(b.layer_name ?? ''))

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated">
      <div className="px-3 py-2 border-b border-wm-border/60 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.08em] font-bold truncate text-wm-accent-strong">
            {group.layer_name ?? group.key} · {items.length}
          </p>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30 hover:bg-wm-accent/15 transition-colors"
          >
            <Plus size={11} /> Add
          </button>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] font-bold text-wm-text-muted mb-1.5">
            Card template
          </p>
          {/* Visual grid of card variants, mirroring the section-level
              "Change variant" picker so the strategist can see each
              card's layout rather than guessing from a name dropdown. */}
          <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto pr-1">
            {cardList.map(t => {
              const isSelected = t.id === templateId
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPickTemplate(t.id)}
                  title={t.layer_name}
                  className={[
                    'rounded-md overflow-hidden border bg-white text-left transition-colors',
                    isSelected
                      ? 'border-wm-accent ring-2 ring-wm-accent/30'
                      : 'border-wm-border hover:border-wm-border-focus',
                  ].join(' ')}
                >
                  <div className="relative aspect-[4/3] bg-wm-bg-hover">
                    {t.preview_image_url ? (
                      <img src={t.preview_image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-[9px] text-wm-text-subtle">
                        no preview
                      </div>
                    )}
                    {isSelected && (
                      <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-wm-accent text-white inline-flex items-center justify-center">
                        <Check size={10} />
                      </span>
                    )}
                  </div>
                  <p className="px-2 py-1 text-[10px] font-semibold text-wm-text truncate">
                    {t.layer_name}
                  </p>
                </button>
              )
            })}
          </div>
          {cardList.length === 0 && (
            <p className="text-[11px] text-wm-text-subtle italic">
              No {group.referenced_family ?? 'card'} templates loaded.
            </p>
          )}
        </div>
      </div>

      {!selectedCard ? (
        <p className="px-3 py-3 text-[11px] text-wm-text-subtle italic">
          Pick a card template to start editing items.
        </p>
      ) : items.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-wm-text-subtle italic">
          No items yet — click Add.
        </p>
      ) : (
        <ul>
          {items.map((item, idx) => (
            <li
              key={idx}
              className={['px-3 py-2', idx > 0 ? 'border-t border-wm-border/40' : ''].join(' ')}
            >
              <PaletteItemBlock
                idx={idx}
                schema={cardSchema}
                snippets={snippets}
                item={item}
                onPatch={(patch) => setItem(idx, patch)}
                onRemove={() => removeItem(idx)}
                depth={depth + 1}
                cardTemplates={cardTemplates}
                basePath={basePath ? `${basePath}.items` : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PaletteItemBlock({
  idx, schema, snippets, item, onPatch, onRemove, depth, cardTemplates, basePath,
}: {
  idx: number
  schema: WebFieldDef[]
  snippets: readonly WMSnippetOption[]
  item: Record<string, unknown>
  onPatch: (patch: Record<string, unknown>) => void
  onRemove: () => void
  depth: number
  cardTemplates: Record<string, WebContentTemplate>
  basePath?: string
}) {
  const [open, setOpen] = useState(idx < 2)
  return (
    <div>
      <div className="flex items-center gap-1 group/cell">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-accent-strong transition-colors min-w-0"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="font-semibold">Item {idx + 1}</span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto h-6 w-6 grid place-items-center rounded text-wm-text-subtle hover:bg-wm-danger-bg hover:text-wm-danger opacity-0 group-hover/cell:opacity-100 transition-opacity"
          title="Remove item"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2.5">
          {schema.filter(isEditableSchemaField).map((field, i) => {
            const childPath = basePath ? `${basePath}.${idx}.${field.key}` : undefined
            return field.kind === 'slot' ? (
              <SlotEditor
                key={field.key + '-' + i}
                slot={field}
                value={item[field.key]}
                onChange={(v) => onPatch({ [field.key]: v })}
                snippets={snippets}
                fieldPath={childPath}
              />
            ) : (
              <GroupEditor
                key={field.key + '-' + i}
                group={field}
                value={item[field.key]}
                onChange={(v) => onPatch({ [field.key]: v })}
                snippets={snippets}
                depth={depth + 1}
                cardTemplates={cardTemplates}
                fieldPath={childPath}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Render one item as a flat row — used when the group's item_schema
 *  is just a single editable slot (e.g. FAQ heading, list_item heading).
 *  Avoids the chevron-nested feel inside cards. */
function FlatListRow({
  idx, total: _total, schema, semantics, snippets, item, onPatch, onRemove, basePath,
}: {
  idx: number
  total: number
  schema: WebFieldDef[]
  semantics: GroupSemantics
  snippets: readonly WMSnippetOption[]
  item: Record<string, unknown>
  onPatch: (patch: Record<string, unknown>) => void
  onRemove: () => void
  basePath?: string
}) {
  const slot = schema.find(f => f.kind === 'slot')
  if (!slot || slot.kind !== 'slot') return null
  return (
    <li className="flex items-start gap-2 group/row">
      <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mt-2.5 shrink-0 tabular-nums">
        {String(idx + 1).padStart(2, '0')}
      </span>
      <div className="flex-1 min-w-0">
        <SlotEditor
          slot={slot}
          value={item[slot.key]}
          onChange={(v) => onPatch({ [slot.key]: v })}
          snippets={snippets}
          fieldPath={basePath ? `${basePath}.${idx}.${slot.key}` : undefined}
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        title={`Remove ${semantics.itemLabel.toLowerCase()}`}
        className="h-6 w-6 grid place-items-center rounded text-wm-text-subtle hover:bg-wm-danger-bg hover:text-wm-danger opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0 mt-2"
      >
        <Trash2 size={11} />
      </button>
    </li>
  )
}

function isSingleSlotList(group: WebGroupDef): boolean {
  if (!Array.isArray(group.item_schema) || group.item_schema.length !== 1) return false
  const f = group.item_schema[0]
  if (f.kind !== 'slot') return false
  // Reserve the flat-row layout for short-form slots only. Richtext
  // bodies (the long descriptions in a List Item / FAQ item / etc.)
  // need the full-width ItemCard layout — squeezing them between a
  // numeric prefix and a remove button cramps the editor and toolbar.
  return f.type === 'text' || f.type === 'cta' || f.type === 'url' || f.type === 'email' || f.type === 'phone'
}

function ItemCard({
  item, idx, total, schema, semantics, snippets, depth, isOpen,
  onToggle, onPatch, onRemove, onMoveUp, onMoveDown, cardTemplates, basePath,
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
  cardTemplates?: Record<string, WebContentTemplate>
  basePath?: string
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
            const childPath = basePath ? `${basePath}.${idx}.${field.key}` : undefined
            if (field.kind === 'slot') {
              return (
                <SlotEditor
                  key={field.key + '-' + i}
                  slot={field}
                  value={item[field.key]}
                  onChange={(v) => onPatch({ [field.key]: v })}
                  snippets={snippets}
                  depth={depth}
                  fieldPath={childPath}
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
                cardTemplates={cardTemplates}
                fieldPath={childPath}
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
