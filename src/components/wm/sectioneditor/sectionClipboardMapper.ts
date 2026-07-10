/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shape-mapping helper: turn a SOURCE section's field_values into an
 * ITEM object that fits a TARGET group's item_schema.
 *
 * The mapper walks the target's item_schema slot-by-slot and looks for a
 * matching source value based on slot SHAPE (heading-class, description-
 * class, tagline, button/CTA, image) rather than exact key names. So a
 * source `heading` lands in the target's `heading_card`; a source
 * `description` or `body` lands in `description_card` / `excerpt_card`;
 * a source `tagline` lands in `tagline_card`; the source's first
 * button-shaped value lands in the first button-shaped slot.
 *
 * Lossy by design — the user accepts a best-fit mapping when they paste.
 * The UI surfaces a brief preview before commit so they can back out.
 */
import type { WebFieldDef, WebSlotDef } from '../../../types/database'

type SourceShape = 'heading' | 'tagline' | 'description' | 'cta' | 'image' | 'other'

function shapeOfSlot(slot: WebSlotDef): SourceShape {
  const key = (slot.key ?? '').toLowerCase()
  const layer = (slot.layer_name ?? '').toLowerCase()
  const combined = `${key} ${layer}`
  if (slot.scope === 'button' || slot.type === 'cta') return 'cta'
  if (slot.type === 'image') return 'image'
  if (/heading|title|h1|h2|h3|name/.test(combined)) return 'heading'
  if (/tagline|eyebrow|kicker|subheading|subhead|label/.test(combined)) return 'tagline'
  if (slot.type === 'richtext') return 'description'
  if (/description|body|excerpt|summary|paragraph|info|content/.test(combined)) return 'description'
  return 'other'
}

function shapeOfValueKey(key: string): SourceShape {
  const k = key.toLowerCase()
  if (/heading|title|h1|h2|h3|name/.test(k)) return 'heading'
  if (/tagline|eyebrow|kicker|subheading|subhead/.test(k)) return 'tagline'
  if (/description|body|excerpt|summary|paragraph|info|content/.test(k)) return 'description'
  if (/button|cta|contact|apply|link/.test(k)) return 'cta'
  if (/image|photo|picture|graphic|logo|avatar/.test(k)) return 'image'
  return 'other'
}

interface SourceCandidate {
  key:   string
  shape: SourceShape
  value: unknown
}

/** Walk a source field_values object recursively, collecting every
 *  leaf-ish value (string / cta-shape / image-shape) with its inferred
 *  shape. Used to pull candidates out of a section that has either
 *  flat slots (heading + body + buttons) OR groups with one inner
 *  item (single_instance_hint card). Multi-item groups are picked
 *  apart so the FIRST item's values become candidates — pasting one
 *  section into one item naturally collapses lists. */
function collectCandidates(
  values: Record<string, unknown>,
  fields: ReadonlyArray<WebFieldDef> | null | undefined,
): SourceCandidate[] {
  const out: SourceCandidate[] = []
  if (!fields) {
    // No schema — fall back to walking the values directly.
    for (const [k, v] of Object.entries(values)) {
      if (k.startsWith('__')) continue
      if (v == null || v === '') continue
      if (typeof v === 'string') out.push({ key: k, shape: shapeOfValueKey(k), value: v })
      else if (typeof v === 'object' && !Array.isArray(v) && ('label' in v || 'url' in v)) {
        out.push({ key: k, shape: 'cta', value: v })
      }
    }
    return out
  }
  for (const f of fields) {
    if (f.kind === 'slot') {
      const v = values[f.key]
      if (v == null || v === '') continue
      out.push({ key: f.key, shape: shapeOfSlot(f as WebSlotDef), value: v })
    } else if (f.kind === 'group') {
      const items = Array.isArray(values[f.key]) ? (values[f.key] as Array<Record<string, unknown>>) : []
      // For button-family groups, pull the first item's button value up.
      const layer = (f.layer_name ?? '').toLowerCase()
      const isButtonsGroup = /button/.test(layer) || /button/.test(f.key.toLowerCase())
      if (isButtonsGroup && items.length > 0) {
        // Look for a contact-like leaf inside the first button item.
        const first = items[0]
        for (const [, v] of Object.entries(first)) {
          if (typeof v === 'string' && v.length > 0) {
            // Heuristic: treat as a CTA label. URL might be alongside.
            const urlVal = first['url']
            out.push({
              key:   f.key,
              shape: 'cta',
              value: typeof urlVal === 'string' && urlVal.length > 0
                ? { label: v, url: urlVal }
                : { label: v, url: '' },
            })
            break
          }
        }
      } else if (items.length > 0) {
        // Recurse into the FIRST item; collapse list/cards down to one.
        const innerFields = (f.item_schema ?? []) as WebFieldDef[]
        out.push(...collectCandidates(items[0], innerFields))
      }
    }
  }
  return out
}

/** Map a source section's bound values into a single item object that
 *  fits the target group's item_schema. Slots in the target without
 *  a shape-matched source value remain unset (the strategist can fill
 *  them after). */
export function mapToTargetItem(
  sourceValues: Record<string, unknown>,
  sourceFields: ReadonlyArray<WebFieldDef> | null | undefined,
  targetItemSchema: ReadonlyArray<WebFieldDef>,
): Record<string, unknown> {
  const candidates = collectCandidates(sourceValues, sourceFields)

  // Group candidates by shape so we can consume them in shape order
  // and avoid double-binding the same source value to two target slots.
  const byShape = new Map<SourceShape, SourceCandidate[]>()
  for (const c of candidates) {
    const list = byShape.get(c.shape) ?? []
    list.push(c)
    byShape.set(c.shape, list)
  }
  const consume = (shape: SourceShape): unknown | undefined => {
    const list = byShape.get(shape)
    if (!list || list.length === 0) return undefined
    return list.shift()?.value
  }

  const out: Record<string, unknown> = {}
  const fillSlot = (slot: WebSlotDef): void => {
    const shape = shapeOfSlot(slot)
    let value: unknown | undefined
    if (shape === 'heading' || shape === 'tagline' || shape === 'description' || shape === 'cta' || shape === 'image') {
      value = consume(shape)
    }
    // Descriptions can fall back to a heading if no description is on
    // the source (e.g. a hero with only heading + tagline pasted into
    // a card that has heading + body); a tagline can fall back to a
    // description short snippet. Don't overdo it — only fill cleanly.
    if (value == null && shape === 'description') value = consume('tagline')
    if (value == null && shape === 'tagline')     value = consume('description')
    if (value == null) return
    out[slot.key] = value
  }

  const fillGroup = (g: { item_schema?: WebFieldDef[]; default_count?: number; key: string }): void => {
    // For nested groups inside the target item, fill ONE inner item if
    // a candidate of any meaningful shape is still available. Lossy by
    // design — pasting a flat CTA section into a `card` group with a
    // nested `card` group inside collapses to one inner card.
    const innerSchema = (g.item_schema ?? []) as WebFieldDef[]
    const innerItem: Record<string, unknown> = {}
    let anyFilled = false
    for (const innerF of innerSchema) {
      if (innerF.kind === 'slot') {
        const prevSize = Object.keys(innerItem).length
        const slotCopy = innerF as WebSlotDef
        const shape = shapeOfSlot(slotCopy)
        let value: unknown | undefined
        if (shape === 'heading' || shape === 'tagline' || shape === 'description' || shape === 'cta' || shape === 'image') {
          value = consume(shape)
        }
        if (value == null && shape === 'description') value = consume('tagline')
        if (value == null && shape === 'tagline')     value = consume('description')
        if (value != null) {
          innerItem[innerF.key] = value
          if (Object.keys(innerItem).length > prevSize) anyFilled = true
        }
      }
    }
    if (anyFilled) out[g.key] = [innerItem]
  }

  for (const f of targetItemSchema) {
    if (f.kind === 'slot') fillSlot(f as WebSlotDef)
    else if (f.kind === 'group') fillGroup(f)
  }

  return out
}

/** A short human-readable summary of what the mapping will do, for
 *  the paste preview. Lists target slot → source label pairs, omitting
 *  unfilled slots. */
export function describeMapping(
  sourceValues: Record<string, unknown>,
  sourceFields: ReadonlyArray<WebFieldDef> | null | undefined,
  targetItemSchema: ReadonlyArray<WebFieldDef>,
): Array<{ targetLabel: string; sourceShape: SourceShape; preview: string }> {
  const mapped = mapToTargetItem(sourceValues, sourceFields, targetItemSchema)
  const result: Array<{ targetLabel: string; sourceShape: SourceShape; preview: string }> = []
  for (const f of targetItemSchema) {
    if (f.kind !== 'slot') continue
    const slot = f as WebSlotDef
    if (mapped[slot.key] == null) continue
    const v = mapped[slot.key]
    let preview = ''
    if (typeof v === 'string') preview = v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    else if (typeof v === 'object' && v != null && 'label' in v) preview = String((v as { label?: string }).label ?? '').slice(0, 80)
    result.push({
      targetLabel: slot.label ?? slot.layer_name ?? slot.key,
      sourceShape: shapeOfSlot(slot),
      preview,
    })
  }
  return result
}
