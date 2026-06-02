/**
 * Client-side parser for Brixies template `source_html`.
 *
 * Builds an index from `data-layer` values to the template's slot /
 * group schema. The BrixiesLayoutEditor uses the resulting map to
 * decide, for each DOM element it walks, whether to render an inline-
 * editable slot, a repeating group, or a static container.
 *
 * Mirrors the slot-detection in scripts/import-brixies-catalog.mjs —
 * the importer wrote `template.fields` keyed by these same data-layer
 * names, so re-walking the (trimmed) source_html with the schema in
 * hand is a clean round-trip.
 *
 * Note: source_html may have been trimmed by the importer to ONE
 * instance per detected group. The group's `default_count` tells us
 * how many to render; the first data-layer-bearing child of the
 * group's container is the "item template" we clone per item.
 */
import type { WebFieldDef, WebSlotDef, WebGroupDef } from '../types/database'

export interface SlotBinding {
  kind: 'slot'
  field: WebSlotDef
  /** Dotted path into field_values — for nested items, includes the
   *  group's key + item index, e.g. "cards.0.heading_card". */
  path: string
}

export interface GroupBinding {
  kind: 'group'
  field: WebGroupDef
  path: string
}

export type LayerBinding = SlotBinding | GroupBinding

export interface LayoutBindingMap {
  /** layer_name → binding, scoped to the section's TOP-LEVEL fields.
   *  Nested item bindings are resolved per-item at render time using
   *  the group's item_schema. */
  topLevel: Map<string, LayerBinding>
  /** group key → item_schema by layer_name; for resolving slots
   *  inside a group's repeated item DOM. */
  itemSchemas: Map<string, Map<string, WebSlotDef | WebGroupDef>>
}

/** Build the binding map for a template's fields. Run once per template
 *  when the editor mounts. */
export function buildBindingMap(fields: ReadonlyArray<WebFieldDef>): LayoutBindingMap {
  const topLevel = new Map<string, LayerBinding>()
  const itemSchemas = new Map<string, Map<string, WebSlotDef | WebGroupDef>>()

  for (const f of fields) {
    // Lookup key: prefer layer_name (matches the data-layer attribute
    // verbatim); fall back to key. Tolerate case differences.
    const layer = (f.layer_name ?? f.key)
    topLevel.set(layer, f.kind === 'slot'
      ? { kind: 'slot', field: f, path: f.key }
      : { kind: 'group', field: f, path: f.key })

    if (f.kind === 'group') {
      const itemMap = new Map<string, WebSlotDef | WebGroupDef>()
      for (const sub of f.item_schema) {
        const subLayer = (sub.layer_name ?? sub.key)
        itemMap.set(subLayer, sub)
      }
      itemSchemas.set(f.key, itemMap)
    }
  }

  return { topLevel, itemSchemas }
}

/** Normalize a data-layer attribute for tolerant matching:
 *  trim whitespace, lowercase, collapse spaces. */
export function normalizeLayer(name: string | null | undefined): string {
  if (!name) return ''
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Find a binding for a given layer name. Tolerates case differences. */
export function findBinding(
  map: LayoutBindingMap,
  layerName: string | null | undefined,
): LayerBinding | undefined {
  if (!layerName) return undefined
  // First try exact (preserves Brixies's "Container info" casing).
  if (map.topLevel.has(layerName)) return map.topLevel.get(layerName)
  // Then normalized — handles odd whitespace or casing variants.
  const norm = normalizeLayer(layerName)
  for (const [k, v] of map.topLevel.entries()) {
    if (normalizeLayer(k) === norm) return v
  }
  return undefined
}

/** Find a SUB-binding inside a group's item schema. */
export function findItemBinding(
  map: LayoutBindingMap,
  groupKey: string,
  layerName: string | null | undefined,
): WebSlotDef | WebGroupDef | undefined {
  if (!layerName) return undefined
  const itemMap = map.itemSchemas.get(groupKey)
  if (!itemMap) return undefined
  if (itemMap.has(layerName)) return itemMap.get(layerName)
  const norm = normalizeLayer(layerName)
  for (const [k, v] of itemMap.entries()) {
    if (normalizeLayer(k) === norm) return v
  }
  return undefined
}

/** Parse source_html into a DOM root. Returns null if parsing fails. */
export function parseSourceHtml(sourceHtml: string): Element | null {
  if (typeof window === 'undefined' || !sourceHtml) return null
  try {
    const doc = new DOMParser().parseFromString(sourceHtml, 'text/html')
    // Brixies HTML is a single root <div data-layer="Family N">. The
    // parsed doc has it as body.firstElementChild.
    return doc.body.firstElementChild
  } catch {
    return null
  }
}

/** Slot-presence summary for the section header — how many of each
 *  type the template expects, vs how many are filled. */
export interface SlotPresenceSummary {
  images: { expected: number; filled: number }
  ctas: { expected: number; filled: number }
  cards: { expected: number; filled: number; groupKey: string | null }
}

export function summarizeSlotPresence(
  template: { fields: ReadonlyArray<WebFieldDef> },
  values: Record<string, unknown>,
): SlotPresenceSummary {
  const out: SlotPresenceSummary = {
    images: { expected: 0, filled: 0 },
    ctas:   { expected: 0, filled: 0 },
    cards:  { expected: 0, filled: 0, groupKey: null },
  }

  const isCardKey = (k: string): boolean => {
    const c = k.toLowerCase().replace(/[_\s-]+/g, '')
    if (c.includes('button') || c === 'cta' || c === 'ctas' || c.includes('action')) return false
    return c.includes('card') || c === 'items' || c === 'features' || c === 'tiles'
      || c === 'blocks' || c === 'pillars' || c === 'tiers' || c === 'programs'
      || c === 'members' || c === 'groups' || c === 'classes' || c === 'events'
      || c === 'steps' || c === 'doctrines' || c === 'values' || c === 'routing'
  }
  const isCtaKey = (k: string): boolean => {
    const c = k.toLowerCase().replace(/[_\s-]+/g, '')
    return c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')
  }

  // Recursively count image slots — image_grid / hero / card-with-photo
  // groups bury their image slots inside item_schemas, and the previous
  // pass only looked at top-level slots. For a hero with 5 image slots
  // in a single-instance items group, this returns 5 (was 0). `filled`
  // is intentionally always 0 — the user doesn't edit images in this
  // builder; the count is the only surfaced signal.
  const countImagesInSchema = (fields: ReadonlyArray<WebFieldDef>): number => {
    let n = 0
    for (const f of fields) {
      if (f.kind === 'slot') {
        if (f.type === 'image') n += 1
      } else {
        const per = countImagesInSchema(f.item_schema)
        // Multiply by default_count when the group repeats — e.g. a
        // 3-card group where each card has 1 image yields 3 images.
        // single_instance_hint groups behave like default_count=1.
        const multiplier = f.single_instance_hint ? 1 : Math.max(1, f.default_count ?? 1)
        n += per * multiplier
      }
    }
    return n
  }
  out.images.expected = countImagesInSchema(template.fields)

  for (const f of template.fields) {
    if (f.kind === 'slot') {
      if (f.type === 'cta') {
        out.ctas.expected += 1
        const v = values[f.key]
        if (typeof v === 'object' && v !== null
            && typeof (v as { label?: unknown }).label === 'string'
            && (v as { label: string }).label !== '') {
          out.ctas.filled += 1
        }
      }
    } else {
      const items = Array.isArray(values[f.key]) ? values[f.key] as unknown[] : []
      if (isCtaKey(f.key)) {
        out.ctas.expected += f.default_count
        out.ctas.filled += items.filter(it =>
          typeof it === 'object' && it !== null &&
          Object.values(it as object).some(v => typeof v === 'string' && v !== ''),
        ).length
      } else if (isCardKey(f.key)) {
        if (out.cards.groupKey === null) out.cards.groupKey = f.key
        out.cards.expected += f.default_count
        out.cards.filled += items.filter(it =>
          typeof it === 'object' && it !== null &&
          Object.values(it as object).some(v =>
            (typeof v === 'string' && v !== '')
            || (typeof v === 'object' && v !== null),
          ),
        ).length
      }
    }
  }
  return out
}

/** Walk every slot in the template (including item-schema slots) and
 *  report which are over their max_chars limit given current values. */
export interface OverLimitSlot {
  path: string         // e.g. "heading" or "cards.0.heading_card"
  label: string        // human-readable
  used: number
  max: number
}

export function findOverLimitSlots(
  template: { fields: ReadonlyArray<WebFieldDef> },
  values: Record<string, unknown>,
): OverLimitSlot[] {
  const out: OverLimitSlot[] = []
  const walkSlot = (slot: WebSlotDef, value: unknown, path: string) => {
    if (!slot.max_chars) return
    const text = typeof value === 'string'
      ? stripHtml(value)
      : (typeof value === 'object' && value !== null && typeof (value as { label?: unknown }).label === 'string'
        ? (value as { label: string }).label
        : '')
    if (text.length > slot.max_chars) {
      out.push({
        path,
        label: slot.label ?? slot.key,
        used: text.length,
        max: slot.max_chars,
      })
    }
  }
  const walkFields = (fields: ReadonlyArray<WebFieldDef>, values: Record<string, unknown>, parentPath: string) => {
    for (const f of fields) {
      const path = parentPath ? `${parentPath}.${f.key}` : f.key
      if (f.kind === 'slot') {
        walkSlot(f, values[f.key], path)
      } else {
        const items = Array.isArray(values[f.key]) ? values[f.key] as Array<Record<string, unknown>> : []
        items.forEach((item, i) => {
          walkFields(f.item_schema, item, `${path}[${i}]`)
        })
      }
    }
  }
  walkFields(template.fields, values, '')
  return out
}

function stripHtml(s: string): string {
  if (typeof window === 'undefined') return s
  const div = document.createElement('div')
  div.innerHTML = s
  return (div.textContent ?? '').trim()
}
