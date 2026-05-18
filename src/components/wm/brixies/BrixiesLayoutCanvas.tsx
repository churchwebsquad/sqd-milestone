/**
 * Brixies layout canvas — field-faithful renderer.
 *
 * v3 architecture:
 *   - Iterates `template.fields` in declaration order. Renders every
 *     slot and every group. No categorize-and-pick-first dropping.
 *   - Per-slot rendering via EditableSlot (handles richtext, text,
 *     cta, image, boolean, datetime, form-input).
 *   - Per-group rendering via GroupRenderer, which picks an internal
 *     layout (card grid / step list / cta row / generic list) from
 *     the group's key shape.
 *   - Strategist can always add CTAs / cards. When the template has
 *     a matching slot/group, the toolbar fills/appends there; when
 *     it doesn't, the additions land in `field_values.__extra_ctas`
 *     / `__extra_cards`, rendered in an Extras zone at the bottom
 *     with a clear "freehand additions" hint.
 *   - Layout shape is light: headings render with appropriate scale
 *     based on heading_level; tagline slots render small + uppercase;
 *     body / richtext slots get generous line-height; CTAs render as
 *     pill buttons.
 */
import { EditableSlot } from './EditableSlot'
import type {
  WebContentTemplate, WebSlotDef, WebGroupDef, WebFieldDef,
} from '../../../types/database'

interface Props {
  template: WebContentTemplate
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

export function BrixiesLayoutCanvas({ template, values, onChange }: Props) {
  // Mutation helpers — operate on the parent's field_values.
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

  // Freehand extras — present when the strategist added CTAs / cards
  // to a template that doesn't natively support them. Rendered at the
  // bottom with a warning border.
  const extraCtas = Array.isArray(values.__extra_ctas)
    ? values.__extra_ctas as Array<{ label?: string; url?: string }>
    : []
  const extraCards = Array.isArray(values.__extra_cards)
    ? values.__extra_cards as Array<Record<string, unknown>>
    : []

  const setExtraCta = (idx: number, v: { label?: string; url?: string }) => {
    const next = [...extraCtas]
    next[idx] = { ...next[idx], ...v }
    onChange({ ...values, __extra_ctas: next })
  }
  const removeExtraCta = (idx: number) => {
    const next = [...extraCtas]
    next.splice(idx, 1)
    onChange({ ...values, __extra_ctas: next })
  }
  const setExtraCard = (idx: number, key: string, v: unknown) => {
    const next = [...extraCards]
    next[idx] = { ...next[idx], [key]: v }
    onChange({ ...values, __extra_cards: next })
  }
  const removeExtraCard = (idx: number) => {
    const next = [...extraCards]
    next.splice(idx, 1)
    onChange({ ...values, __extra_cards: next })
  }

  return (
    <div className="bx-canvas">
      <div className="bx-canvas-fields">
        {template.fields.map((field, i) => (
          <FieldRow
            key={field.key + ':' + i}
            field={field}
            values={values}
            setSlot={setSlot}
            setItem={setItem}
            removeItem={removeItem}
            addItem={addItem}
          />
        ))}
      </div>

      {(extraCtas.length > 0 || extraCards.length > 0) && (
        <div className="bx-extras">
          <p className="bx-extras-header">
            Freehand additions <span>— not in the template. Bind a different layout to keep these structured.</span>
          </p>
          {extraCtas.length > 0 && (
            <div className="bx-extras-row">
              <p className="bx-extras-label">Extra CTAs</p>
              <div className="flex flex-wrap gap-2 items-center">
                {extraCtas.map((cta, idx) => (
                  <ExtraCta
                    key={idx}
                    value={cta}
                    onChange={(v) => setExtraCta(idx, v)}
                    onRemove={() => removeExtraCta(idx)}
                  />
                ))}
              </div>
            </div>
          )}
          {extraCards.length > 0 && (
            <div className="bx-extras-row">
              <p className="bx-extras-label">Extra cards</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {extraCards.map((card, idx) => (
                  <ExtraCard
                    key={idx}
                    value={card}
                    onChange={(k, v) => setExtraCard(idx, k, v)}
                    onRemove={() => removeExtraCard(idx)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Field renderer ──────────────────────────────────────────────────

function FieldRow({
  field, values, setSlot, setItem, removeItem, addItem,
}: {
  field: WebFieldDef
  values: Record<string, unknown>
  setSlot: (key: string, v: unknown) => void
  setItem: (groupKey: string, idx: number, itemKey: string, v: unknown) => void
  removeItem: (groupKey: string, idx: number) => void
  addItem: (groupKey: string) => void
}) {
  if (field.kind === 'slot') {
    return <SlotRow slot={field} value={values[field.key]} onChange={(v) => setSlot(field.key, v)} />
  }
  return (
    <GroupRow
      group={field}
      items={Array.isArray(values[field.key]) ? values[field.key] as Array<Record<string, unknown>> : []}
      onItem={(idx, key, v) => setItem(field.key, idx, key, v)}
      onAdd={() => addItem(field.key)}
      onRemove={(idx) => removeItem(field.key, idx)}
    />
  )
}

// ── Slot row — wraps EditableSlot with typography matching the slot ──

function SlotRow({
  slot, value, onChange,
}: {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  // The slot-type-appropriate wrapper provides the visual scale:
  //   - heading_level 1 → text-3xl bold
  //   - heading_level 2 → text-xl semibold
  //   - heading_level 3+ → text-base semibold
  //   - tagline-shaped → text-[12px] uppercase tracking-widest accent
  //   - richtext / body → prose-sm leading-relaxed
  //   - image → block with its own placeholder styling (no wrapper)
  //   - cta → inline pill
  //   - boolean / form-input / datetime → compact inline

  const c = slot.key.toLowerCase().replace(/[_\s-]+/g, '')
  const isTagline = c.includes('tagline') || c.includes('eyebrow') || c.includes('kicker')

  // Image and form-input slots render compact, not inside a labeled wrapper.
  if (slot.type === 'image' || slot.type === 'form-input') {
    return (
      <div className="bx-field bx-field-compact">
        <EditableSlot slot={slot} value={value} onChange={onChange} />
      </div>
    )
  }

  // Headings — render the slot as the appropriate heading level.
  if (slot.heading_level === 1) {
    return (
      <h1 className="bx-field bx-h1">
        <EditableSlot slot={slot} value={value} onChange={onChange} />
      </h1>
    )
  }
  if (slot.heading_level === 2) {
    return (
      <h2 className="bx-field bx-h2">
        <EditableSlot slot={slot} value={value} onChange={onChange} />
      </h2>
    )
  }
  if (slot.heading_level && slot.heading_level >= 3) {
    return (
      <h3 className="bx-field bx-h3">
        <EditableSlot slot={slot} value={value} onChange={onChange} />
      </h3>
    )
  }
  if (isTagline) {
    return (
      <div className="bx-field bx-tagline">
        <EditableSlot slot={slot} value={value} onChange={onChange} />
      </div>
    )
  }
  if (slot.type === 'richtext') {
    return (
      <div className="bx-field bx-body">
        <EditableSlot slot={slot} value={value} onChange={onChange} />
      </div>
    )
  }
  if (slot.type === 'cta') {
    return (
      <div className="bx-field bx-cta-button">
        <EditableSlot slot={slot} value={value} onChange={onChange} />
      </div>
    )
  }
  if (slot.type === 'boolean' || slot.type === 'datetime') {
    return (
      <div className="bx-field bx-field-compact">
        <span className="bx-field-label">{slot.label ?? slot.key.replace(/_/g, ' ')}:</span>
        <EditableSlot slot={slot} value={value} onChange={onChange} />
      </div>
    )
  }
  // Default: text slot, plain.
  return (
    <div className="bx-field bx-text-line">
      <EditableSlot slot={slot} value={value} onChange={onChange} />
    </div>
  )
}

// ── Group row — picks an internal layout based on group shape ─────────

function GroupRow({
  group, items, onItem, onAdd, onRemove,
}: {
  group: WebGroupDef
  items: Array<Record<string, unknown>>
  onItem: (idx: number, itemKey: string, v: unknown) => void
  onAdd: () => void
  onRemove: (idx: number) => void
}) {
  const c = group.key.toLowerCase().replace(/[_\s-]+/g, '')
  const isCta = c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')
  const isStep = c.includes('step') || c.includes('process')
  // Default: treat any other group as a card-ish grid.
  const layoutMode: 'cta-row' | 'step-list' | 'card-grid' =
    isCta ? 'cta-row' : isStep ? 'step-list' : 'card-grid'

  const count = items.length > 0 ? items.length : group.default_count

  if (layoutMode === 'cta-row') {
    return (
      <div className="bx-field bx-cta-row">
        {Array.from({ length: count }).map((_, idx) => (
          <CtaItem
            key={idx}
            schema={group.item_schema}
            values={items[idx] ?? {}}
            onChange={(k, v) => onItem(idx, k, v)}
            onRemove={() => onRemove(idx)}
          />
        ))}
        <button type="button" onClick={onAdd} className="bx-group-add">+ Add button</button>
      </div>
    )
  }

  if (layoutMode === 'step-list') {
    return (
      <div className="bx-field bx-step-list">
        <p className="bx-group-label">{prettyKey(group.key)}</p>
        {Array.from({ length: count }).map((_, idx) => (
          <StepItem
            key={idx}
            index={idx + 1}
            schema={group.item_schema}
            values={items[idx] ?? {}}
            onChange={(k, v) => onItem(idx, k, v)}
            onRemove={() => onRemove(idx)}
          />
        ))}
        <button type="button" onClick={onAdd} className="bx-group-add">+ Add step</button>
      </div>
    )
  }

  // Card grid — column count derived from default_count / actual count.
  const cols = count <= 2 ? 2 : count <= 6 ? 3 : 4
  const colClass = cols === 2 ? 'md:grid-cols-2' : cols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4'
  return (
    <div className="bx-field bx-card-grid-wrap">
      <p className="bx-group-label">{prettyKey(group.key)}</p>
      <div className={`grid grid-cols-1 ${colClass} gap-3`}>
        {Array.from({ length: count }).map((_, idx) => (
          <CardItem
            key={idx}
            schema={group.item_schema}
            values={items[idx] ?? {}}
            onChange={(k, v) => onItem(idx, k, v)}
            onRemove={() => onRemove(idx)}
          />
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="bx-group-add-card"
        >+ Add item</button>
      </div>
    </div>
  )
}

// ── Group item renderers ────────────────────────────────────────────

function CardItem({
  schema, values, onChange, onRemove,
}: {
  schema: ReadonlyArray<WebFieldDef>
  values: Record<string, unknown>
  onChange: (key: string, v: unknown) => void
  onRemove: () => void
}) {
  return (
    <div className="bx-card group/card">
      <button
        type="button"
        onClick={onRemove}
        className="bx-card-remove"
        title="Remove item"
      >×</button>
      <div className="bx-card-body">
        {schema.map((f, i) => (
          <FieldRow
            key={f.key + ':' + i}
            field={f}
            values={values}
            setSlot={(k, v) => onChange(k, v)}
            setItem={() => {}}
            removeItem={() => {}}
            addItem={() => {}}
          />
        ))}
      </div>
    </div>
  )
}

function StepItem({
  index, schema, values, onChange, onRemove,
}: {
  index: number
  schema: ReadonlyArray<WebFieldDef>
  values: Record<string, unknown>
  onChange: (key: string, v: unknown) => void
  onRemove: () => void
}) {
  return (
    <div className="bx-step group/step">
      <div className="bx-step-number">{index}</div>
      <div className="bx-step-body min-w-0 flex-1">
        {schema.map((f, i) => (
          <FieldRow
            key={f.key + ':' + i}
            field={f}
            values={values}
            setSlot={(k, v) => onChange(k, v)}
            setItem={() => {}}
            removeItem={() => {}}
            addItem={() => {}}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="bx-card-remove"
        title="Remove step"
      >×</button>
    </div>
  )
}

function CtaItem({
  schema, values, onChange, onRemove,
}: {
  schema: ReadonlyArray<WebFieldDef>
  values: Record<string, unknown>
  onChange: (key: string, v: unknown) => void
  onRemove: () => void
}) {
  // CTAs render as pills regardless of internal schema shape. If the
  // item_schema has a single cta-typed slot, that's the value. If it's
  // a button-label text slot + __cta_url, we handle both.
  const ctaSlot = schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && f.type === 'cta') ?? null
  const labelSlot = schema.find((f): f is WebSlotDef =>
    f.kind === 'slot' && f.type === 'text'
    && (f.scope === 'button' || /button|cta/i.test(f.label ?? '') || /button/i.test(f.layer_name ?? ''))) ?? null

  if (ctaSlot) {
    return (
      <div className="bx-cta-button group/cta">
        <EditableSlot
          slot={ctaSlot}
          value={values[ctaSlot.key]}
          onChange={(v) => onChange(ctaSlot.key, v)}
          onRemoveItem={onRemove}
        />
      </div>
    )
  }
  if (labelSlot) {
    const label = (values[labelSlot.key] as string | undefined) ?? ''
    const url = (values.__cta_url as string | undefined) ?? ''
    return (
      <span className="bx-slot bx-slot-cta bx-cta-button group/cta">
        <input
          type="text"
          value={label}
          onChange={e => onChange(labelSlot.key, e.target.value)}
          placeholder="Button label"
          className="bx-cta-label"
        />
        <span className="bx-cta-arrow">→</span>
        <input
          type="url"
          value={url}
          onChange={e => onChange('__cta_url', e.target.value)}
          placeholder="/route"
          className="bx-cta-url"
        />
        <button
          type="button"
          onClick={onRemove}
          className="bx-item-remove"
          title="Remove"
        >×</button>
      </span>
    )
  }
  // No recognizable slot — render the schema generically.
  return (
    <div className="bx-cta-button group/cta">
      {schema.map((f, i) => f.kind === 'slot' ? (
        <EditableSlot
          key={f.key + ':' + i}
          slot={f}
          value={values[f.key]}
          onChange={(v) => onChange(f.key, v)}
          onRemoveItem={onRemove}
        />
      ) : null)}
    </div>
  )
}

// ── Extras (freehand additions) ─────────────────────────────────────

function ExtraCta({
  value, onChange, onRemove,
}: {
  value: { label?: string; url?: string }
  onChange: (v: { label?: string; url?: string }) => void
  onRemove: () => void
}) {
  return (
    <span className="bx-slot bx-slot-cta bx-cta-button">
      <input
        type="text"
        value={value.label ?? ''}
        onChange={e => onChange({ ...value, label: e.target.value })}
        placeholder="Button label"
        className="bx-cta-label"
      />
      <span className="bx-cta-arrow">→</span>
      <input
        type="url"
        value={value.url ?? ''}
        onChange={e => onChange({ ...value, url: e.target.value })}
        placeholder="/route"
        className="bx-cta-url"
      />
      <button
        type="button"
        onClick={onRemove}
        className="bx-item-remove"
        title="Remove"
      >×</button>
    </span>
  )
}

function ExtraCard({
  value, onChange, onRemove,
}: {
  value: Record<string, unknown>
  onChange: (key: string, v: unknown) => void
  onRemove: () => void
}) {
  // Extras follow a generic card shape: heading + body + optional CTA.
  const heading = typeof value.heading === 'string' ? value.heading : ''
  const body = typeof value.body === 'string' ? value.body : ''
  const cta = (typeof value.cta === 'object' && value.cta !== null)
    ? value.cta as { label?: string; url?: string }
    : { label: '', url: '' }
  return (
    <div className="bx-card group/card">
      <button type="button" onClick={onRemove} className="bx-card-remove" title="Remove">×</button>
      <input
        type="text"
        value={heading}
        onChange={e => onChange('heading', e.target.value)}
        placeholder="Card heading"
        className="bx-slot bx-slot-text bx-h3"
      />
      <textarea
        value={body}
        onChange={e => onChange('body', e.target.value)}
        placeholder="Card body"
        rows={3}
        className="bx-slot bx-slot-text bx-body"
      />
      <div className="bx-cta-button">
        <input
          type="text"
          value={cta.label ?? ''}
          onChange={e => onChange('cta', { ...cta, label: e.target.value })}
          placeholder="Button label"
          className="bx-cta-label"
        />
        <span className="bx-cta-arrow">→</span>
        <input
          type="url"
          value={cta.url ?? ''}
          onChange={e => onChange('cta', { ...cta, url: e.target.value })}
          placeholder="/route"
          className="bx-cta-url"
        />
      </div>
    </div>
  )
}

// ── Utilities ───────────────────────────────────────────────────────

function prettyKey(key: string): string {
  return key.replace(/[_-]+/g, ' ').trim()
}
