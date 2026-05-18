/**
 * Brixies layout canvas — schema-driven structural renderer.
 *
 * Replaces the prior attempt that injected editable inputs into the
 * Brixies `source_html` directly. That approach broke because Brixies
 * HTML is a Figma export frozen at the 1512px Desktop canvas with
 * fixed pixel widths on every inner container (660px columns,
 * 340x340 images, etc.) — overrides on the outer wrapper couldn't
 * reach the inner widths, and the result rendered as a broken
 * blow-out instead of a polished section.
 *
 * The new canvas takes the structural identity of the bound Brixies
 * template (its slot + group schema) and renders a clean Tailwind
 * layout using our own brand tokens. Slot rendering is inline-
 * editable via EditableSlot (reused). Group repeats add / remove
 * via the same field_values mutation pattern as before.
 *
 * Layout shape is derived from which slots / groups exist on the
 * template:
 *   - Tagline (if present) sits as a small uppercase eyebrow at top.
 *   - Heading + body stack in the primary column.
 *   - If the template has an image slot, the primary column is
 *     ~60% and a grey placeholder rectangle fills the other ~40%.
 *   - Top-level CTAs render as a row of pill buttons below the body.
 *   - The first card-shaped group renders as a card grid below the
 *     hero block, with N cards (column count derived from
 *     default_count: 2-col for 2-3 items, 3-col for 4-6, 4-col for 7+).
 *   - The first step-shaped group renders as a numbered vertical
 *     list (Process Sections).
 *   - Boolean / datetime / form-input slots render as compact inline
 *     controls at the bottom under a small "Settings" sub-section.
 *
 * The Brixies catalog is still the source of truth for WHICH slots
 * and groups exist — we just don't inject editables into its frozen
 * Figma HTML anymore.
 */
import { Image as ImageIcon } from 'lucide-react'
import { EditableSlot } from './EditableSlot'
import type {
  WebContentTemplate, WebSlotDef, WebGroupDef, WebFieldDef,
} from '../../../types/database'
import type { WMSnippetOption } from '../RichTextEditor'

interface Props {
  template: WebContentTemplate
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  snippets?: readonly WMSnippetOption[]
}

export function BrixiesLayoutCanvas({ template, values, onChange, snippets }: Props) {
  const c = categorize(template.fields)

  // Mutation helpers — top-level slot, group item, and add/remove.
  const setSlot = (key: string, v: unknown) => onChange({ ...values, [key]: v })
  const setItem = (groupKey: string, idx: number, itemKey: string, v: unknown) => {
    const arr = Array.isArray(values[groupKey]) ? [...(values[groupKey] as Array<Record<string, unknown>>)] : []
    while (arr.length <= idx) arr.push({})
    arr[idx] = { ...arr[idx], [itemKey]: v }
    onChange({ ...values, [groupKey]: arr })
  }
  const removeItem = (groupKey: string, idx: number) => {
    const arr = Array.isArray(values[groupKey]) ? [...(values[groupKey] as Array<Record<string, unknown>>)] : []
    arr.splice(idx, 1)
    onChange({ ...values, [groupKey]: arr })
  }
  const addItem = (groupKey: string) => {
    const arr = Array.isArray(values[groupKey]) ? [...(values[groupKey] as Array<Record<string, unknown>>)] : []
    arr.push({})
    onChange({ ...values, [groupKey]: arr })
  }

  const hasImage = c.images.length > 0

  return (
    <div className="bx-canvas rounded-lg border border-wm-border bg-wm-bg-elevated overflow-hidden">
      {/* Hero block — tagline / heading / body / top-level CTAs, with
          optional image placeholder on the right when the template
          has an image slot. */}
      <div className={`p-6 md:p-8 ${hasImage ? 'grid grid-cols-1 md:grid-cols-5 gap-6' : ''}`}>
        <div className={hasImage ? 'md:col-span-3 min-w-0 space-y-4' : 'space-y-4 max-w-3xl'}>
          {c.tagline && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Tagline</p>
              <div className="text-[13px] uppercase tracking-wider font-semibold text-wm-accent-strong">
                <EditableSlot
                  slot={c.tagline}
                  value={values[c.tagline.key]}
                  onChange={(v) => setSlot(c.tagline!.key, v)}
                  snippets={snippets}
                />
              </div>
            </div>
          )}

          {c.heading && (
            <h1 className="text-3xl md:text-4xl font-bold text-wm-text leading-tight">
              <EditableSlot
                slot={c.heading}
                value={values[c.heading.key]}
                onChange={(v) => setSlot(c.heading!.key, v)}
                snippets={snippets}
              />
            </h1>
          )}

          {c.subheading && (
            <h2 className="text-xl md:text-2xl font-semibold text-wm-text leading-snug">
              <EditableSlot
                slot={c.subheading}
                value={values[c.subheading.key]}
                onChange={(v) => setSlot(c.subheading!.key, v)}
                snippets={snippets}
              />
            </h2>
          )}

          {c.body && (
            <div className="text-[15px] text-wm-text leading-relaxed">
              <EditableSlot
                slot={c.body}
                value={values[c.body.key]}
                onChange={(v) => setSlot(c.body!.key, v)}
                snippets={snippets}
              />
            </div>
          )}

          {/* Top-level CTA slots (rare — most templates use a ctaGroup) */}
          {c.ctaSlots.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {c.ctaSlots.map(s => (
                <div key={s.key} className="bx-cta-button">
                  <EditableSlot
                    slot={s}
                    value={values[s.key]}
                    onChange={(v) => setSlot(s.key, v)}
                  />
                </div>
              ))}
            </div>
          )}

          {/* CTA group — buttons row */}
          {c.ctaGroup && (
            <CtaGroupRow
              group={c.ctaGroup}
              items={(values[c.ctaGroup.key] as Array<Record<string, unknown>> | undefined) ?? []}
              onItem={(idx, itemKey, v) => setItem(c.ctaGroup!.key, idx, itemKey, v)}
              onAdd={() => addItem(c.ctaGroup!.key)}
              onRemove={(idx) => removeItem(c.ctaGroup!.key, idx)}
            />
          )}
        </div>

        {hasImage && (
          <div className="md:col-span-2 min-w-0">
            <ImagePlaceholder slots={c.images} />
          </div>
        )}
      </div>

      {/* Step group (Process Sections) — numbered vertical list */}
      {c.stepGroup && (
        <div className="border-t border-wm-border px-6 md:px-8 py-6 bg-wm-bg/40">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-3">
            {prettyGroupName(c.stepGroup.key)}
          </p>
          <StepGroupList
            group={c.stepGroup}
            items={(values[c.stepGroup.key] as Array<Record<string, unknown>> | undefined) ?? []}
            onItem={(idx, itemKey, v) => setItem(c.stepGroup!.key, idx, itemKey, v)}
            onAdd={() => addItem(c.stepGroup!.key)}
            onRemove={(idx) => removeItem(c.stepGroup!.key, idx)}
            snippets={snippets}
          />
        </div>
      )}

      {/* Card group — grid */}
      {c.cardGroup && (
        <div className="border-t border-wm-border px-6 md:px-8 py-6">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-3">
            {prettyGroupName(c.cardGroup.key)}
          </p>
          <CardGrid
            group={c.cardGroup}
            items={(values[c.cardGroup.key] as Array<Record<string, unknown>> | undefined) ?? []}
            onItem={(idx, itemKey, v) => setItem(c.cardGroup!.key, idx, itemKey, v)}
            onAdd={() => addItem(c.cardGroup!.key)}
            onRemove={(idx) => removeItem(c.cardGroup!.key, idx)}
            snippets={snippets}
          />
        </div>
      )}

      {/* Settings — boolean / datetime / form-input slots that don't
          have a natural place in the layout. Tucked at the bottom. */}
      {c.settingsSlots.length > 0 && (
        <div className="border-t border-wm-border px-6 md:px-8 py-4 bg-wm-bg/40">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">Settings</p>
          <div className="flex flex-wrap gap-3 items-center text-[13px] text-wm-text">
            {c.settingsSlots.map(s => (
              <div key={s.key} className="inline-flex items-center gap-2">
                <span className="text-wm-text-muted">{s.label ?? s.key.replace(/_/g, ' ')}:</span>
                <EditableSlot
                  slot={s}
                  value={values[s.key]}
                  onChange={(v) => setSlot(s.key, v)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-layouts ─────────────────────────────────────────────────────

function ImagePlaceholder({ slots }: { slots: WebSlotDef[] }) {
  // Render a stack of grey rectangles, one per image slot. Most
  // templates have a single hero image; some galleries have 3+.
  return (
    <div className={slots.length > 1 ? 'grid grid-cols-2 gap-2' : ''}>
      {slots.map(s => (
        <div
          key={s.key}
          className="aspect-video rounded-md border border-dashed border-wm-border bg-wm-bg-hover grid place-items-center text-wm-text-subtle"
          title={`${s.label ?? s.key} (image placeholder — upload in Assets step)`}
        >
          <div className="flex flex-col items-center gap-1">
            <ImageIcon size={20} />
            <span className="text-[10px] uppercase tracking-wider">{s.label ?? s.key}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function CtaGroupRow({
  group, items, onItem, onAdd, onRemove,
}: {
  group: WebGroupDef
  items: Array<Record<string, unknown>>
  onItem: (idx: number, itemKey: string, v: unknown) => void
  onAdd: () => void
  onRemove: (idx: number) => void
}) {
  const count = items.length > 0 ? items.length : 0
  // Find the cta-typed slot, or button-label text slot, inside
  // item_schema. We render one pill per item.
  const ctaSlot = group.item_schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && f.type === 'cta')
  const labelSlot = group.item_schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && f.type === 'text'
    && (f.scope === 'button' || /button|cta/i.test(f.label ?? '') || /button/i.test(f.layer_name ?? '')))
  const urlKey = '__cta_url'

  return (
    <div className="flex flex-wrap gap-2 items-center pt-2">
      {Array.from({ length: count }).map((_, idx) => {
        const item = items[idx] ?? {}
        return (
          <div key={idx} className="bx-cta-button group/cta">
            {ctaSlot ? (
              <EditableSlot
                slot={ctaSlot}
                value={item[ctaSlot.key]}
                onChange={(v) => onItem(idx, ctaSlot.key, v)}
                onRemoveItem={() => onRemove(idx)}
              />
            ) : labelSlot ? (
              <div className="flex items-baseline gap-2">
                <EditableSlot
                  slot={labelSlot}
                  value={item[labelSlot.key]}
                  onChange={(v) => onItem(idx, labelSlot.key, v)}
                />
                <span className="bx-cta-arrow">→</span>
                <input
                  type="url"
                  value={(item[urlKey] as string | undefined) ?? ''}
                  onChange={e => onItem(idx, urlKey, e.target.value)}
                  placeholder="/route"
                  className="bx-cta-url"
                />
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="bx-item-remove"
                  title="Remove"
                >×</button>
              </div>
            ) : null}
          </div>
        )
      })}
      <button type="button" onClick={onAdd} className="bx-group-add">+ Add button</button>
    </div>
  )
}

function CardGrid({
  group, items, onItem, onAdd, onRemove, snippets,
}: {
  group: WebGroupDef
  items: Array<Record<string, unknown>>
  onItem: (idx: number, itemKey: string, v: unknown) => void
  onAdd: () => void
  onRemove: (idx: number) => void
  snippets?: readonly WMSnippetOption[]
}) {
  const count = items.length > 0 ? items.length : group.default_count
  const cols = count <= 2 ? 2 : count <= 6 ? 3 : 4
  const colClass = cols === 2 ? 'md:grid-cols-2' : cols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4'

  return (
    <div className={`grid grid-cols-1 ${colClass} gap-3`}>
      {Array.from({ length: count }).map((_, idx) => {
        const item = items[idx] ?? {}
        return (
          <CardItem
            key={idx}
            schema={group.item_schema}
            values={item}
            onChange={(itemKey, v) => onItem(idx, itemKey, v)}
            onRemove={() => onRemove(idx)}
            snippets={snippets}
          />
        )
      })}
      <button
        type="button"
        onClick={onAdd}
        className="bx-group-add rounded-md border border-dashed border-wm-border bg-wm-bg hover:bg-wm-bg-hover text-wm-text-muted hover:text-wm-text transition-colors min-h-[8rem] grid place-items-center"
      >
        + Add item
      </button>
    </div>
  )
}

function CardItem({
  schema, values, onChange, onRemove, snippets,
}: {
  schema: ReadonlyArray<WebFieldDef>
  values: Record<string, unknown>
  onChange: (itemKey: string, v: unknown) => void
  onRemove: () => void
  snippets?: readonly WMSnippetOption[]
}) {
  // Categorize the card item's schema the same way we do top-level —
  // heading + body + cta = the natural shape of a card.
  const headingSlot = schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && /heading|h|title|name|label/i.test(f.key)) ?? null
  const bodySlot = schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && (f.type === 'richtext' || /body|description|content/i.test(f.key))) ?? null
  const ctaSlot = schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && (f.type === 'cta' || (f.type === 'text' && f.scope === 'button'))) ?? null
  const imageSlot = schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && f.type === 'image') ?? null
  const others = schema.filter(f =>
    f !== headingSlot && f !== bodySlot && f !== ctaSlot && f !== imageSlot)

  return (
    <div className="group/card relative rounded-md border border-wm-border bg-wm-bg p-4 space-y-2">
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 inline-flex items-center justify-center w-6 h-6 rounded-md text-wm-text-subtle hover:text-wm-danger hover:bg-wm-danger-bg opacity-0 group-hover/card:opacity-100 transition-opacity"
        title="Remove item"
      >×</button>

      {imageSlot && (
        <div
          className="aspect-video rounded-md border border-dashed border-wm-border bg-wm-bg-hover grid place-items-center text-wm-text-subtle text-[10px] mb-2"
          title="Image placeholder — upload in Assets step"
        >
          <ImageIcon size={16} />
        </div>
      )}

      {headingSlot && (
        <h3 className="text-base font-semibold text-wm-text">
          <EditableSlot
            slot={headingSlot}
            value={values[headingSlot.key]}
            onChange={(v) => onChange(headingSlot.key, v)}
            snippets={snippets}
          />
        </h3>
      )}

      {bodySlot && (
        <div className="text-[13px] text-wm-text-muted leading-relaxed">
          <EditableSlot
            slot={bodySlot}
            value={values[bodySlot.key]}
            onChange={(v) => onChange(bodySlot.key, v)}
            snippets={snippets}
          />
        </div>
      )}

      {ctaSlot && (
        <div className="pt-1">
          <EditableSlot
            slot={ctaSlot}
            value={values[ctaSlot.key]}
            onChange={(v) => onChange(ctaSlot.key, v)}
          />
        </div>
      )}

      {/* Render any other slots in the card schema we didn't claim
          above (rare — captions, dates, etc.) */}
      {others.map(f => f.kind === 'slot' ? (
        <div key={f.key} className="text-[12px] text-wm-text-muted flex items-baseline gap-2">
          <span>{f.label ?? f.key.replace(/_/g, ' ')}:</span>
          <EditableSlot
            slot={f}
            value={values[f.key]}
            onChange={(v) => onChange(f.key, v)}
          />
        </div>
      ) : null)}
    </div>
  )
}

function StepGroupList({
  group, items, onItem, onAdd, onRemove, snippets,
}: {
  group: WebGroupDef
  items: Array<Record<string, unknown>>
  onItem: (idx: number, itemKey: string, v: unknown) => void
  onAdd: () => void
  onRemove: (idx: number) => void
  snippets?: readonly WMSnippetOption[]
}) {
  const count = items.length > 0 ? items.length : group.default_count
  const headingSlot = group.item_schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && /heading|h|title|name/i.test(f.key)) ?? null
  const bodySlot = group.item_schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && (f.type === 'richtext' || /body|description|content/i.test(f.key))) ?? null

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, idx) => {
        const item = items[idx] ?? {}
        return (
          <div key={idx} className="group/step flex gap-3 relative">
            <div className="shrink-0 w-7 h-7 rounded-full bg-wm-accent-tint text-wm-accent-strong font-bold text-[12px] grid place-items-center">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              {headingSlot && (
                <div className="text-[14px] font-semibold text-wm-text">
                  <EditableSlot
                    slot={headingSlot}
                    value={item[headingSlot.key]}
                    onChange={(v) => onItem(idx, headingSlot.key, v)}
                    snippets={snippets}
                  />
                </div>
              )}
              {bodySlot && (
                <div className="text-[13px] text-wm-text-muted leading-relaxed">
                  <EditableSlot
                    slot={bodySlot}
                    value={item[bodySlot.key]}
                    onChange={(v) => onItem(idx, bodySlot.key, v)}
                    snippets={snippets}
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onRemove(idx)}
              className="absolute top-0 right-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-wm-text-subtle hover:text-wm-danger hover:bg-wm-danger-bg opacity-0 group-hover/step:opacity-100 transition-opacity"
              title="Remove step"
            >×</button>
          </div>
        )
      })}
      <button type="button" onClick={onAdd} className="bx-group-add">+ Add step</button>
    </div>
  )
}

// ── Categorization ──────────────────────────────────────────────────

interface Categorized {
  tagline: WebSlotDef | null
  heading: WebSlotDef | null
  subheading: WebSlotDef | null
  body: WebSlotDef | null
  ctaSlots: WebSlotDef[]      // top-level cta slots (rare)
  ctaGroup: WebGroupDef | null
  cardGroup: WebGroupDef | null
  stepGroup: WebGroupDef | null
  images: WebSlotDef[]
  settingsSlots: WebSlotDef[]
}

function categorize(fields: ReadonlyArray<WebFieldDef>): Categorized {
  const out: Categorized = {
    tagline: null, heading: null, subheading: null, body: null,
    ctaSlots: [], ctaGroup: null, cardGroup: null, stepGroup: null,
    images: [], settingsSlots: [],
  }
  for (const f of fields) {
    if (f.kind === 'slot') {
      const c = f.key.toLowerCase().replace(/[_\s-]+/g, '')
      if (!out.tagline && (c.includes('tagline') || c.includes('eyebrow') || c.includes('kicker'))) {
        out.tagline = f; continue
      }
      if (f.heading_level === 1 && !out.heading) { out.heading = f; continue }
      if (f.heading_level === 2 && !out.subheading) { out.subheading = f; continue }
      if (!out.heading && (c === 'h' || c.includes('heading') || c.includes('title'))) {
        out.heading = f; continue
      }
      if (!out.body && (f.type === 'richtext' || c.includes('body') || c.includes('description') || c.includes('content'))) {
        out.body = f; continue
      }
      if (f.type === 'image') { out.images.push(f); continue }
      if (f.type === 'cta') { out.ctaSlots.push(f); continue }
      if (f.type === 'boolean' || f.type === 'datetime' || f.type === 'form-input') {
        out.settingsSlots.push(f); continue
      }
    } else {
      const c = f.key.toLowerCase().replace(/[_\s-]+/g, '')
      const isCta = c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')
      const isStep = c.includes('step') || c.includes('process')
      const isCard = c.includes('card') || c === 'items' || c === 'features'
        || c === 'tiles' || c === 'blocks' || c === 'list' || c === 'rows'
        || c === 'pillars' || c === 'tiers' || c === 'programs'
        || c === 'members' || c === 'groups' || c === 'classes'
        || c === 'events' || c === 'doctrines' || c === 'values'
      if (isCta && !out.ctaGroup) { out.ctaGroup = f; continue }
      if (isStep && !out.stepGroup) { out.stepGroup = f; continue }
      if (isCard && !out.cardGroup) { out.cardGroup = f; continue }
    }
  }
  return out
}

function prettyGroupName(key: string): string {
  return key.replace(/[_-]+/g, ' ').trim()
}
