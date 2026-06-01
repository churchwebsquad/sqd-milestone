/**
 * Aggressive auto-mapper for unmapped content.
 *
 * The import pipeline ends with leftover keys in `__unmapped` when the
 * cowork brief contains fields the bound template can't hold. The old
 * UX surfaced those as a warning and asked the user to manually swap
 * templates. This module instead **drains** the unmapped bucket by
 * shape-converting each leftover key into a compatible slot on the
 * current template — and exposes the same conversion primitives to
 * the UI so the strategist can manually move any key into any slot.
 *
 * Three layers:
 *
 *   1. `autoMapAggressive` — runs during bind, after reconcile.
 *      Scores every (unmapped_key, target_slot) pair, picks the best
 *      fit per key, applies the conversion, and updates `fieldValues`.
 *      Always tries to find a home; only leaves a key truly unmapped
 *      when no slot can hold it in any shape.
 *
 *   2. `findPlacements` — pure scorer. Given an unmapped key + a
 *      template, returns every viable placement (target slot path +
 *      conversion type + readable label + fit score). Used by the UI
 *      to render the per-key "Move to →" dropdown.
 *
 *   3. `applyPlacement` — pure applier. Given an unmapped key + a
 *      chosen placement, returns the new fieldValues with the value
 *      written into the slot (after conversion) and the key removed
 *      from __unmapped.
 *
 * Conversion table:
 *
 *   string            → text/richtext   (direct or append)
 *   string            → cta             (wrap as {label, url:''})
 *   string            → image           (only when URL-shaped)
 *   array<string>     → text/richtext   (join with bullets / · separators)
 *   array<string>     → group           (each string → first text slot)
 *   array<string>     → cta             (first string as label)
 *   array<object>     → group           (direct or shape-aligned)
 *   array<object>     → text/richtext   (extract heading-ish field, join)
 *   {label,url}       → cta             (direct)
 *   {label,url}       → text            (extract label)
 *   {items: [...]}    → group           (unwrap items, recurse)
 *   {key: val, …}     → group with 1 item
 */
import { isButtonShapedSlot, normalizeCtaValue, type CtaValue } from './cta'
import type {
  WebContentTemplate, WebFieldDef, WebSlotDef, WebGroupDef,
} from '../types/database'

// ── Public types ──────────────────────────────────────────────────────

export type ConversionKind =
  | 'direct'                  // shape already matches
  | 'append_to_richtext'      // write into a non-empty richtext slot
  | 'join_strings_text'       // ["a","b"] → "a · b"
  | 'join_strings_richtext'   // ["a","b"] → "<ul><li>a</li>…"
  | 'first_string'            // ["a","b"] → "a"
  | 'wrap_as_cta_label'       // "Sign Up" → {label:"Sign Up", url:""}
  | 'extract_cta_label'       // {label,url} → "label"
  | 'extract_cta_url'         // {label,url} → "url"
  | 'strings_to_group'        // ["a","b"] → [{text:"a"},{text:"b"}]
  | 'objects_to_group'        // [{x},{y}] → group items (shape align)
  | 'objects_to_richtext'     // [{heading:"a"},{heading:"b"}] → "a · b"
  | 'wrap_as_single_item'     // string → group[0].first_text_slot
  | 'url_to_image'            // "https://…/foo.jpg" → image slot src

export interface Placement {
  /** Dotted path from field_values root. For top-level slots, length 1
   *  (e.g. ['description']). For group items, length 3 — group key +
   *  item index + slot key (e.g. ['cards','0','heading']). */
  slot_path:     string[]
  /** Human-readable label for the dropdown ("Description Card",
   *  "Card 3 → Heading", etc.). */
  slot_label:    string
  /** What shape conversion will run when this placement is applied. */
  conversion:    ConversionKind
  /** One-line explanation of the conversion, shown next to the slot
   *  in the picker ("joins items with bullets" / "uses first string as
   *  label"). Empty string for direct (no conversion). */
  conversion_note: string
  /** Fit score 0-100. The auto-mapper picks the highest scoring
   *  placement per unmapped key; the UI sorts the dropdown by fit. */
  fit:           number
  /** True when the target slot is currently empty. The auto-mapper
   *  strongly prefers empty slots so it doesn't clobber user copy. */
  is_empty:      boolean
  /** When the target is a group, the item_schema the converter should
   *  re-key items against. For palette-referenced groups this is the
   *  palette template's top-level fields (the group's own item_schema
   *  is empty []); for native groups it's the group's item_schema.
   *  Without this, items placed in the wrong shape render as empty
   *  cards because none of their keys match the target slots. */
  effective_item_schema?: WebFieldDef[]
}

export interface PlacementLogEntry {
  /** The unmapped key that was placed. */
  source_key:    string
  /** Short preview of the value (first ~80 chars, stringified). */
  source_preview: string
  /** Where it landed (slot_path joined). */
  slot_label:    string
  /** What conversion ran. */
  conversion:    ConversionKind
  conversion_note: string
}

export interface AutoMapResult {
  /** Updated field_values with placements applied. */
  fieldValues:   Record<string, unknown>
  /** Keys we couldn't place anywhere — usually 0 after aggressive run. */
  stillUnmapped: Record<string, unknown>
  /** Log of every placement we made. Surfaced in the panel banner so
   *  the strategist sees what we moved. */
  placements:    PlacementLogEntry[]
}

// ── Aggressive auto-map ────────────────────────────────────────────────

/** Run during bind, after reconcile. Drains as much of `__unmapped` as
 *  possible by placing each leftover into the best-fit slot of the
 *  current template, applying shape conversions when necessary.
 *
 *  Aggressive = picks the highest-scoring placement even when fit is
 *  modest. The strategist always sees the result in the panel + can
 *  undo via manual remap. Better to surface content than hide it. */
export function autoMapAggressive(
  unmapped:      Record<string, unknown>,
  template:      WebContentTemplate | null,
  fieldValues:   Record<string, unknown>,
): AutoMapResult {
  if (!template || !Array.isArray(template.fields)) {
    return { fieldValues, stillUnmapped: unmapped, placements: [] }
  }
  let working = { ...fieldValues }
  const placements: PlacementLogEntry[] = []
  const stillUnmapped: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(unmapped)) {
    if (value == null || value === '') continue

    const options = findPlacements(key, value, template, working)
    if (options.length === 0) {
      stillUnmapped[key] = value
      continue
    }
    // Pick the best fit; ties broken by emptiness (empty slot preferred)
    // then by lower index in the schema (top-of-template wins).
    const best = options[0]
    const applied = applyPlacement(working, key, value, best)
    working = applied.fieldValues
    placements.push({
      source_key:      key,
      source_preview:  previewValue(value),
      slot_label:      best.slot_label,
      conversion:      best.conversion,
      conversion_note: best.conversion_note,
    })
  }
  return { fieldValues: working, stillUnmapped, placements }
}

// ── Placement scoring ────────────────────────────────────────────────

/** Return every viable placement for `value` in `template`, sorted by
 *  fit score (highest first), then by emptiness (empty slot preferred),
 *  then by schema position (earlier slots first). Deduplicates by
 *  slot_path so the dropdown doesn't render the same slot twice when
 *  multiple conversions match.
 *
 *  `paletteTemplates` is the Card-family lookup map. Required so
 *  palette-referenced groups (Feature 2/22/82/106's `card`) get the
 *  palette's schema as their effective item_schema and the
 *  re-keying pass can align item field names. */
export function findPlacements(
  unmappedKey:      string,
  value:            unknown,
  template:         WebContentTemplate,
  fieldValues:      Record<string, unknown>,
  paletteTemplates: Record<string, WebContentTemplate> = {},
): Placement[] {
  const options: Placement[] = []
  const shape = detectShape(value)

  if (!Array.isArray(template.fields)) return options

  let slotIndex = 0
  for (const field of template.fields) {
    if (field.kind === 'slot') {
      slotIndex++
      const slotPlacements = scoreSlot(field, [field.key], shape, value, fieldValues, unmappedKey, slotIndex)
      options.push(...slotPlacements)
    } else if (field.kind === 'group') {
      slotIndex++
      const groupPlacements = scoreGroup(field, [field.key], shape, value, fieldValues, unmappedKey, slotIndex, paletteTemplates)
      options.push(...groupPlacements)
    }
  }

  // Sort: fit desc → empty preferred → original schema order preserved
  options.sort((a, b) => {
    if (a.fit !== b.fit) return b.fit - a.fit
    if (a.is_empty !== b.is_empty) return a.is_empty ? -1 : 1
    return 0
  })
  // Dedupe by slot_path — keep the highest-scoring placement per slot.
  const seen = new Set<string>()
  const deduped: Placement[] = []
  for (const p of options) {
    const k = p.slot_path.join('.')
    if (seen.has(k)) continue
    seen.add(k)
    deduped.push(p)
  }
  return deduped
}

/** True when the placement is a "whole structured value lands as-is"
 *  move (placing into a matching group, dropping a CTA into a CTA
 *  slot, etc.). The UI uses this to promote group placements above
 *  text-stuffing fallbacks in the dropdown. */
export function isStructuredPlacement(p: Placement): boolean {
  return p.conversion === 'direct'
      || p.conversion === 'objects_to_group'
      || p.conversion === 'strings_to_group'
      || p.conversion === 'wrap_as_single_item'
}

/** One-line preview of what would land in the target slot if this
 *  placement is applied. Used to label each dropdown option so the
 *  strategist sees the resulting copy / structure before committing. */
export function previewConversion(value: unknown, p: Placement): string {
  const converted = runConversion(value, p.conversion, undefined)
  return summarizeConverted(converted)
}

function summarizeConverted(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') {
    // Strip simple HTML tags for the preview line.
    const stripped = v.replace(/<\/?[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return stripped.length > 120 ? stripped.slice(0, 117) + '…' : stripped
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return 'empty list'
    const head = v.slice(0, 3).map(item => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        return pickStringField(o, ['name', 'heading', 'title', 'label', 'text']) || '…'
      }
      return String(item)
    }).join(', ')
    return v.length > 3 ? `${v.length} items: ${head}, …` : `${v.length} items: ${head}`
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.label === 'string' || typeof o.url === 'string') {
      const l = typeof o.label === 'string' ? o.label : ''
      const u = typeof o.url === 'string' ? o.url : ''
      return l && u ? `${l} → ${u}` : (l || u)
    }
    if (Array.isArray(o.items)) {
      return summarizeConverted(o.items)
    }
    return Object.keys(o).slice(0, 3).join(' / ')
  }
  return String(v)
}

// ── Apply a chosen placement ──────────────────────────────────────────

/** Write `value` (converted per `placement.conversion`) into the slot
 *  identified by `placement.slot_path`, removing `key` from any
 *  `__unmapped` stash on the returned fieldValues. For group
 *  placements, also re-keys each item's fields against the group's
 *  effective item_schema so items shipped with the wrong key names
 *  (e.g. cowork's staff_cards items use `name/title/email` but the
 *  target group's schema has `heading/description/cta`) actually
 *  bind to the slots rather than rendering as empty cards. Pure. */
export function applyPlacement(
  fieldValues: Record<string, unknown>,
  key:         string,
  value:       unknown,
  placement:   Placement,
): { fieldValues: Record<string, unknown> } {
  const out: Record<string, unknown> = { ...fieldValues }
  let converted = runConversion(value, placement.conversion, getExisting(out, placement.slot_path))
  // Re-key items when the placement targets a group with an effective
  // item_schema. Only fires for group-bound conversions.
  if (placement.effective_item_schema && placement.effective_item_schema.length > 0
      && (placement.conversion === 'direct'
       || placement.conversion === 'objects_to_group'
       || placement.conversion === 'strings_to_group'
       || placement.conversion === 'wrap_as_single_item')
      && Array.isArray(converted)) {
    converted = reKeyItemsToSchema(converted as Array<Record<string, unknown>>, placement.effective_item_schema)
  }
  setAtPath(out, placement.slot_path, converted)

  // Remove from __unmapped if present.
  const um = out.__unmapped
  if (um && typeof um === 'object' && !Array.isArray(um)) {
    const next: Record<string, unknown> = { ...(um as Record<string, unknown>) }
    delete next[key]
    out.__unmapped = Object.keys(next).length > 0 ? next : undefined
    if (out.__unmapped === undefined) delete out.__unmapped
  }
  // Also drop the raw top-level copy of `key` if it was hanging around
  // (legacy imports sometimes left the raw key alongside the
  // __unmapped stash). Without this, dropping into a slot leaves the
  // original ghost in the field_values tree.
  if (key in out && key !== '__unmapped') delete out[key]
  return { fieldValues: out }
}

/** For each source item, re-key its fields against the group's
 *  effective item_schema. Uses semantic aliasing (name → heading,
 *  title → description, etc.) so cowork-shipped items bind into
 *  generic card slots even when the field names don't match. Fields
 *  with no target stay on the item under their original key so the
 *  data isn't lost — the panel can still surface them. */
function reKeyItemsToSchema(
  items:      Array<Record<string, unknown>>,
  itemSchema: WebFieldDef[],
): Array<Record<string, unknown>> {
  if (itemSchema.length === 0) return items
  return items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const remapped: Record<string, unknown> = {}
    const usedTargets = new Set<string>()

    // Pass 1: exact key match → preserve.
    for (const f of itemSchema) {
      const key = f.key
      if (key in item && !isEmptyValue(item[key])) {
        remapped[key] = item[key]
        usedTargets.add(key)
      }
    }

    // Pass 2: alias match for unfilled slots.
    for (const f of itemSchema) {
      if (usedTargets.has(f.key)) continue
      const sourceKey = pickAliasSource(item, f)
      if (sourceKey && !isEmptyValue(item[sourceKey])) {
        remapped[f.key] = item[sourceKey]
        usedTargets.add(f.key)
      }
    }

    // Pass 3: carry over any source fields that didn't find a target.
    // Stays under the original key so the data isn't dropped. The
    // panel's group editor renders these as extra "unmapped on this
    // card" entries (future enhancement).
    for (const [k, v] of Object.entries(item)) {
      if (k in remapped) continue
      const matched = itemSchema.some(f => f.key === k)
      if (matched) continue
      remapped[k] = v
    }

    return remapped
  })
}

/** Find a source key on `item` whose name is a semantic alias of the
 *  target slot's key. Uses STAFF_KEY_ALIASES + general NAME_ALIASES. */
function pickAliasSource(
  item:   Record<string, unknown>,
  target: WebFieldDef,
): string | null {
  const targetCanon = canon(target.key)
  const targetLayer = canon(target.layer_name ?? '')

  // Build the alias set for the target slot.
  const aliasSet = new Set<string>([targetCanon, targetLayer])
  for (const group of NAME_ALIASES) {
    if (group.has(targetCanon) || group.has(targetLayer)) {
      for (const k of group) aliasSet.add(k)
    }
  }
  // Also pull staff-specific cross-domain aliases — staff cards
  // routinely land in generic Card item_schemas; these bridges let
  // name → heading, title → description bind cleanly.
  for (const [src, targets] of Object.entries(STAFF_KEY_ALIASES)) {
    if (targets.includes(targetCanon)) aliasSet.add(canon(src))
    if (aliasSet.has(canon(src))) for (const t of targets) aliasSet.add(t)
  }

  for (const sourceKey of Object.keys(item)) {
    if (aliasSet.has(canon(sourceKey))) return sourceKey
  }
  return null
}

/** Cross-domain aliases that the general NAME_ALIASES groups don't
 *  capture. Staff cards (name/title/email) routinely need to land in
 *  generic feature-card item_schemas (heading/description/cta). */
const STAFF_KEY_ALIASES: Record<string, string[]> = {
  name:  ['heading', 'title', 'h1', 'h2'],
  title: ['description', 'body', 'subheading', 'subtitle', 'role'],
  role:  ['description', 'body', 'subheading', 'title'],
  email: ['cta', 'contact', 'button', 'link'],
}

/** Return the schema items should align to. For palette-referenced
 *  groups, that's the palette template's TOP-LEVEL fields (since
 *  the palette renders items by binding against its own root
 *  schema). For native groups, it's the group's own item_schema. */
function resolveEffectiveItemSchema(
  group:            WebGroupDef,
  paletteTemplates: Record<string, WebContentTemplate>,
): WebFieldDef[] {
  if (group.item_template_ref && group.referenced_template_id) {
    const palette = paletteTemplates[group.referenced_template_id]
    if (palette && Array.isArray(palette.fields)) return palette.fields
  }
  return Array.isArray(group.item_schema) ? group.item_schema : []
}

/** Human-readable summary of a group's item_schema for the dropdown
 *  rationale. Lists up to 4 slot keys; truncates with "…" beyond. */
function itemSchemaSummary(schema: WebFieldDef[]): string {
  if (schema.length === 0) return 'the group'
  const keys = schema.slice(0, 4).map(f => f.key)
  if (schema.length > keys.length) keys.push('…')
  return `each item's ${keys.join(' / ')}`
}

// ── Shape healing for already-persisted data ──────────────────────────

/** One item in a group whose key doesn't match the group's item_schema.
 *  Detected at panel-render time so users can heal data that was
 *  placed before the re-keying pipeline shipped. */
export interface ShapeMismatch {
  group_key:   string
  group_label: string
  item_index:  number
  source_key:  string
  target_key:  string
  value_preview: string
}

/** Walk `fieldValues` against `template`'s group schemas; surface every
 *  item whose source key has a viable alias target on the group's
 *  effective item_schema but isn't already aligned. */
export function findShapeMismatches(
  template:         WebContentTemplate,
  fieldValues:      Record<string, unknown>,
  paletteTemplates: Record<string, WebContentTemplate> = {},
): ShapeMismatch[] {
  const out: ShapeMismatch[] = []
  if (!Array.isArray(template.fields)) return out

  for (const field of template.fields) {
    if (field.kind !== 'group') continue
    const items = fieldValues[field.key]
    if (!Array.isArray(items)) continue
    const itemSchema = resolveEffectiveItemSchema(field, paletteTemplates)
    if (itemSchema.length === 0) continue

    const schemaKeys = new Set(itemSchema.map(f => canon(f.key)))
    items.forEach((item, idx) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return
      for (const [srcKey, value] of Object.entries(item as Record<string, unknown>)) {
        if (schemaKeys.has(canon(srcKey))) continue   // already aligned
        if (isEmptyValue(value)) continue
        // Look for an alias target whose slot is currently empty on this item.
        for (const targetField of itemSchema) {
          if (canon(targetField.key) === canon(srcKey)) break
          const itemRec = item as Record<string, unknown>
          if (!isEmptyValue(itemRec[targetField.key])) continue
          if (isAliasMatch(srcKey, targetField)) {
            out.push({
              group_key:    field.key,
              group_label:  groupLabel(field),
              item_index:   idx,
              source_key:   srcKey,
              target_key:   targetField.key,
              value_preview: previewValue(value),
            })
            break
          }
        }
      }
    })
  }
  return out
}

/** Run the same re-keying logic across every group's items, returning
 *  the patched fieldValues. Idempotent — items already in the right
 *  shape pass through unchanged. */
export function healShapeMismatches(
  template:         WebContentTemplate,
  fieldValues:      Record<string, unknown>,
  paletteTemplates: Record<string, WebContentTemplate> = {},
): { fieldValues: Record<string, unknown>; healed: number } {
  const out: Record<string, unknown> = { ...fieldValues }
  let healed = 0
  if (!Array.isArray(template.fields)) return { fieldValues: out, healed }

  for (const field of template.fields) {
    if (field.kind !== 'group') continue
    const items = out[field.key]
    if (!Array.isArray(items)) continue
    const itemSchema = resolveEffectiveItemSchema(field, paletteTemplates)
    if (itemSchema.length === 0) continue
    const before = JSON.stringify(items)
    const reKeyed = reKeyItemsToSchema(items as Array<Record<string, unknown>>, itemSchema)
    if (JSON.stringify(reKeyed) !== before) {
      out[field.key] = reKeyed
      healed++
    }
  }
  return { fieldValues: out, healed }
}

/** True when `sourceKey` would land on `targetField` under the same
 *  alias rules `reKeyItemsToSchema` applies. */
function isAliasMatch(sourceKey: string, targetField: WebFieldDef): boolean {
  const sourceCanon = canon(sourceKey)
  const targetCanon = canon(targetField.key)
  const targetLayer = canon(targetField.layer_name ?? '')
  if (sourceCanon === targetCanon || sourceCanon === targetLayer) return true
  for (const group of NAME_ALIASES) {
    if ((group.has(targetCanon) || group.has(targetLayer)) && group.has(sourceCanon)) return true
  }
  for (const [src, targets] of Object.entries(STAFF_KEY_ALIASES)) {
    if (canon(src) === sourceCanon && targets.includes(targetCanon)) return true
  }
  return false
}

// ── Shape detection ──────────────────────────────────────────────────

export type ValueShape =
  | 'string_plain'      // plain text, no HTML
  | 'string_rich'       // string containing HTML markup
  | 'string_url'        // URL-shaped string (http/https/mailto/tel/{{token}})
  | 'array_strings'     // [string, string, …]
  | 'array_objects'     // [{...}, {...}, …]
  | 'array_mixed'       // mixed array
  | 'object_cta'        // {label?, url?}
  | 'object_items'      // {items: [...]} — group wrapper
  | 'object_record'     // generic object
  | 'empty'             // null / "" / [] / {}

export function detectShape(value: unknown): ValueShape {
  if (value == null) return 'empty'
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t) return 'empty'
    if (/^(https?:\/\/|mailto:|tel:|\/|\{\{)/.test(t) && !/\s/.test(t)) return 'string_url'
    if (/<\/?[a-z][^>]*>/i.test(t)) return 'string_rich'
    return 'string_plain'
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty'
    const allStrings = value.every(v => typeof v === 'string')
    if (allStrings) return 'array_strings'
    const allObjects = value.every(v => v && typeof v === 'object' && !Array.isArray(v))
    if (allObjects) return 'array_objects'
    return 'array_mixed'
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (Array.isArray(o.items)) return 'object_items'
    const hasLabel = typeof o.label === 'string' || typeof o.text === 'string'
                   || typeof o.title === 'string' || typeof o.contact === 'string'
    const hasUrl   = typeof o.url   === 'string' || typeof o.href === 'string'
    if (hasLabel || hasUrl) return 'object_cta'
    if (Object.keys(o).length === 0) return 'empty'
    return 'object_record'
  }
  return 'empty'
}

// ── Slot scoring ─────────────────────────────────────────────────────

function scoreSlot(
  slot:        WebSlotDef,
  path:        string[],
  shape:       ValueShape,
  value:       unknown,
  fieldValues: Record<string, unknown>,
  unmappedKey: string,
  schemaPos:   number,
): Placement[] {
  const out: Placement[] = []
  const existing = getExisting(fieldValues, path)
  const isEmpty = isEmptyValue(existing)
  const label = slotLabel(slot)

  // Direct text/richtext write
  if ((slot.type === 'text' || slot.type === 'richtext' || slot.type === 'url'
       || slot.type === 'email' || slot.type === 'phone' || slot.type === 'datetime')
      && !isButtonShapedSlot(slot)) {

    const isRichtext = slot.type === 'richtext'

    if (shape === 'string_plain' || shape === 'string_rich' || shape === 'string_url') {
      const fit = baseTextFit(unmappedKey, slot, isEmpty, isRichtext, shape, schemaPos)
      out.push({
        slot_path: path, slot_label: label,
        conversion: isEmpty ? 'direct' : (isRichtext ? 'append_to_richtext' : 'direct'),
        conversion_note: isEmpty ? '' : (isRichtext ? 'append below existing copy' : 'replaces current value'),
        fit, is_empty: isEmpty,
      })
    } else if (shape === 'array_strings') {
      const fit = baseTextFit(unmappedKey, slot, isEmpty, isRichtext, shape, schemaPos)
      out.push({
        slot_path: path, slot_label: label,
        conversion: isRichtext ? 'join_strings_richtext' : 'join_strings_text',
        conversion_note: isRichtext ? 'rendered as a bullet list' : 'joined with separators',
        fit, is_empty: isEmpty,
      })
    } else if (shape === 'array_objects' || shape === 'object_items') {
      // {items: [...]} unwraps to objects too — both shapes get the
      // same "extract heading from each item, render as bullets" treatment.
      const fit = baseTextFit(unmappedKey, slot, isEmpty, isRichtext, shape, schemaPos) - 15
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'objects_to_richtext',
        conversion_note: 'extracts the heading/label from each item',
        fit, is_empty: isEmpty,
      })
    } else if (shape === 'object_cta') {
      const fit = baseTextFit(unmappedKey, slot, isEmpty, isRichtext, shape, schemaPos) - 20
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'extract_cta_label',
        conversion_note: `uses ${(value as { label?: string; text?: string }).label ? '"label"' : 'the text value'}`,
        fit, is_empty: isEmpty,
      })
    } else if (shape === 'object_record' || shape === 'array_mixed') {
      // Last-resort catch-all: stringify the structured value so the
      // user can see it land somewhere editable.
      const fit = baseTextFit(unmappedKey, slot, isEmpty, isRichtext, shape, schemaPos) - 25
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'objects_to_richtext',
        conversion_note: 'extracts readable strings from the data',
        fit, is_empty: isEmpty,
      })
    }
  }

  // CTA slot (or button-shaped text slot)
  if (slot.type === 'cta' || isButtonShapedSlot(slot)) {
    if (shape === 'object_cta') {
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'direct',
        conversion_note: '',
        fit: 95 + (isEmpty ? 0 : -25) + nameMatchBoost(unmappedKey, slot),
        is_empty: isEmpty,
      })
    } else if (shape === 'string_plain') {
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'wrap_as_cta_label',
        conversion_note: 'uses your text as the button label (no URL yet)',
        fit: 55 + (isEmpty ? 0 : -25) + nameMatchBoost(unmappedKey, slot),
        is_empty: isEmpty,
      })
    } else if (shape === 'string_url') {
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'wrap_as_cta_label',
        conversion_note: 'treats this as the button URL',
        fit: 65 + (isEmpty ? 0 : -25) + nameMatchBoost(unmappedKey, slot),
        is_empty: isEmpty,
      })
    } else if (shape === 'array_strings' && Array.isArray(value) && (value as string[]).length > 0) {
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'first_string',
        conversion_note: 'uses the first string as the button label',
        fit: 35 + (isEmpty ? 0 : -25),
        is_empty: isEmpty,
      })
    }
  }

  // Image slot
  if (slot.type === 'image') {
    if (shape === 'string_url' && looksLikeImageUrl(value as string)) {
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'url_to_image',
        conversion_note: '',
        fit: 80 + (isEmpty ? 0 : -25),
        is_empty: isEmpty,
      })
    } else if (shape === 'string_plain' && typeof value === 'string' && /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(value)) {
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'url_to_image',
        conversion_note: '',
        fit: 70 + (isEmpty ? 0 : -25),
        is_empty: isEmpty,
      })
    }
  }

  return out
}

function scoreGroup(
  group:            WebGroupDef,
  path:             string[],
  shape:            ValueShape,
  value:            unknown,
  fieldValues:      Record<string, unknown>,
  unmappedKey:      string,
  schemaPos:        number,
  paletteTemplates: Record<string, WebContentTemplate>,
): Placement[] {
  const out: Placement[] = []
  const existing = getExisting(fieldValues, path)
  const isEmpty = isEmptyValue(existing)
  const label = groupLabel(group)
  // Resolve the EFFECTIVE item_schema — palette-referenced groups
  // (item_template_ref) have empty own item_schema; the real shape is
  // on the referenced Card template's top-level fields. Without this,
  // re-keying inside runConversion would have no schema to align to
  // and items land with unmapped keys.
  const effectiveItemSchema = resolveEffectiveItemSchema(group, paletteTemplates)

  // Whole-group placement
  if (shape === 'array_objects' || shape === 'object_items') {
    const items = shape === 'object_items'
      ? ((value as { items?: unknown }).items as unknown[])
      : value as unknown[]
    if (Array.isArray(items)) {
      out.push({
        slot_path: path, slot_label: label,
        conversion: shape === 'object_items' ? 'objects_to_group' : 'direct',
        conversion_note: shape === 'object_items'
          ? `unwraps the items array; aligns each item's fields to ${itemSchemaSummary(effectiveItemSchema)}`
          : `aligns each item's fields to ${itemSchemaSummary(effectiveItemSchema)}`,
        fit: 90 + (isEmpty ? 0 : -30) + nameMatchBoost(unmappedKey, group),
        is_empty: isEmpty,
        effective_item_schema: effectiveItemSchema,
      })
    }
  }
  if (shape === 'array_strings') {
    // Each string becomes one item; we use the FIRST editable text slot
    // in item_schema as the target key.
    const itemTextKey = firstItemTextKey({ ...group, item_schema: effectiveItemSchema } as WebGroupDef)
    if (itemTextKey) {
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'strings_to_group',
        conversion_note: `each string becomes a card → ${itemTextKey}`,
        fit: 70 + (isEmpty ? 0 : -30) + nameMatchBoost(unmappedKey, group),
        is_empty: isEmpty,
        effective_item_schema: effectiveItemSchema,
      })
    }
  }
  if (shape === 'string_plain' || shape === 'string_rich') {
    const itemTextKey = firstItemTextKey({ ...group, item_schema: effectiveItemSchema } as WebGroupDef)
    if (itemTextKey) {
      out.push({
        slot_path: path, slot_label: label,
        conversion: 'wrap_as_single_item',
        conversion_note: `becomes a single card → ${itemTextKey}`,
        fit: 40 + (isEmpty ? 0 : -30),
        is_empty: isEmpty,
        effective_item_schema: effectiveItemSchema,
      })
    }
  }

  // Per-item placement — score the first empty item's slots as if they
  // were top-level. Only when the existing group has fewer items than
  // default_count (a "next empty card" slot exists).
  if (Array.isArray(existing) && existing.length < (group.default_count ?? 1)) {
    const nextIndex = existing.length
    if (Array.isArray(group.item_schema)) {
      for (const inner of group.item_schema) {
        if (inner.kind === 'slot') {
          const innerPath = [...path, String(nextIndex), inner.key]
          out.push(...scoreSlot(inner, innerPath, shape, value, fieldValues, unmappedKey, schemaPos))
        }
      }
    }
  }

  return out
}

// ── Conversion application ───────────────────────────────────────────

function runConversion(value: unknown, kind: ConversionKind, existing: unknown): unknown {
  switch (kind) {
    case 'direct':
      return value
    case 'append_to_richtext': {
      const prev = typeof existing === 'string' ? existing : ''
      const next = String(value ?? '')
      if (!prev) return next
      // Append below with a paragraph break.
      return `${prev}\n${next}`
    }
    case 'join_strings_text': {
      const arr = (value as string[]).filter(s => typeof s === 'string' && s.trim())
      return arr.join(' · ')
    }
    case 'join_strings_richtext': {
      const arr = (value as string[]).filter(s => typeof s === 'string' && s.trim())
      return `<ul>${arr.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
    }
    case 'first_string': {
      const arr = value as string[]
      return arr.find(s => typeof s === 'string' && s.trim()) ?? ''
    }
    case 'wrap_as_cta_label': {
      const s = String(value ?? '').trim()
      const looksUrl = /^(https?:\/\/|mailto:|tel:|\/|\{\{)/.test(s)
      return looksUrl ? { label: '', url: s } : { label: s, url: '' }
    }
    case 'extract_cta_label': {
      const c = normalizeCtaValue(value)
      return c.label || c.url
    }
    case 'extract_cta_url': {
      const c = normalizeCtaValue(value)
      return c.url
    }
    case 'strings_to_group': {
      const arr = (value as string[]).filter(s => typeof s === 'string')
      // Caller is responsible for passing item_text_key context via
      // the placement label; the conversion itself uses 'text' as a
      // safe default key — the renderer's compatible-shape pass will
      // re-key onto the actual schema slot on next bind.
      return arr.map(s => ({ text: s }))
    }
    case 'objects_to_group': {
      // Strip the {items: …} wrapper if present.
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const o = value as { items?: unknown }
        if (Array.isArray(o.items)) return o.items
      }
      return value
    }
    case 'objects_to_richtext': {
      // Unwrap {items: [...]} envelope if present so this conversion
      // handles both array_objects and object_items shapes.
      let raw: unknown = value
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const o = raw as { items?: unknown }
        if (Array.isArray(o.items)) raw = o.items
      }
      // For object_record (a single object with multiple keys), wrap in
      // a one-element array so the same extractor runs.
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) raw = [raw]
      const arr = (Array.isArray(raw) ? raw : []).filter(o => o && typeof o === 'object')
      const lines = arr.map(o => {
        const obj = o as Record<string, unknown>
        // Compose: <strong>Heading</strong> — Description (when both
        // exist); fall back to first non-empty string field.
        const heading = pickStringField(obj, ['heading', 'title', 'name', 'label', 'h1', 'h2'])
        const body    = pickStringField(obj, ['description', 'body', 'content', 'detail', 'summary', 'caption', 'answer'])
        if (heading && body) return `<strong>${escapeHtml(heading)}</strong> — ${escapeHtml(body)}`
        if (heading) return `<strong>${escapeHtml(heading)}</strong>`
        if (body) return escapeHtml(body)
        const first = Object.values(obj).find(v => typeof v === 'string' && (v as string).trim()) as string | undefined
        return first ? escapeHtml(first) : ''
      }).filter(Boolean)
      return `<ul>${lines.map(s => `<li>${s}</li>`).join('')}</ul>`
    }
    case 'wrap_as_single_item': {
      return [{ text: String(value ?? '') }]
    }
    case 'url_to_image':
      return String(value ?? '')
  }
}

// ── Scoring helpers ──────────────────────────────────────────────────

function baseTextFit(
  unmappedKey: string,
  slot:        WebSlotDef,
  isEmpty:     boolean,
  isRichtext:  boolean,
  shape:       ValueShape,
  schemaPos:   number,
): number {
  let f = 50
  f += nameMatchBoost(unmappedKey, slot)
  if (isEmpty) f += 20
  else         f -= 10
  if (isRichtext && (shape === 'array_strings' || shape === 'string_rich')) f += 10
  if (!isRichtext && shape === 'string_plain') f += 5
  // Earlier slots (top of template) preferred so a hero's
  // description doesn't pull content meant for a card.
  f -= Math.min(5, schemaPos / 2)
  return f
}

/** Boost the fit when the unmapped key's name looks like the slot it's
 *  being moved into — `container_left` → `description` (low boost),
 *  `description` → `description` (high boost). */
function nameMatchBoost(unmappedKey: string, field: WebFieldDef): number {
  const k = canon(unmappedKey)
  const fk = canon(field.key)
  const fl = canon(field.layer_name ?? '')
  if (k === fk || k === fl) return 30
  if (fk.includes(k) || k.includes(fk)) return 15
  if (fl.includes(k) || k.includes(fl)) return 10
  // Semantic alias map — common rename pairs.
  for (const aliases of NAME_ALIASES) {
    if (aliases.has(k) && (aliases.has(fk) || aliases.has(fl))) return 12
  }
  return 0
}

const NAME_ALIASES: Array<Set<string>> = [
  new Set(['description', 'body', 'content', 'paragraph', 'info', 'detail', 'summary', 'caption']),
  new Set(['heading', 'title', 'subtitle', 'subheading', 'h1', 'h2']),
  new Set(['tagline', 'eyebrow', 'kicker', 'pretitle']),
  new Set(['image', 'photo', 'picture', 'thumbnail', 'avatar']),
  new Set(['cta', 'button', 'buttons', 'action', 'link']),
  new Set(['cards', 'grid', 'tiles', 'items', 'list']),
  new Set(['name', 'fullname', 'full_name']),
  new Set(['containerleft', 'container_left', 'left', 'left_column', 'leftcolumn']),
  new Set(['containerright', 'container_right', 'right', 'right_column', 'rightcolumn']),
]

function canon(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '')
}

// ── Path helpers ─────────────────────────────────────────────────────

function getExisting(fieldValues: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = fieldValues
  for (const p of path) {
    if (cur == null) return undefined
    if (Array.isArray(cur)) {
      cur = cur[Number(p)]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return cur
}

function setAtPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) return
  if (path.length === 1) {
    target[path[0]] = value
    return
  }
  let cur: Record<string, unknown> | unknown[] = target
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    const next = path[i + 1]
    const nextIsIndex = /^\d+$/.test(next)
    if (Array.isArray(cur)) {
      const idx = Number(seg)
      while (cur.length <= idx) cur.push(nextIsIndex ? [] : {})
      if (cur[idx] == null || typeof cur[idx] !== 'object') {
        cur[idx] = nextIsIndex ? [] : {}
      }
      cur = cur[idx] as Record<string, unknown> | unknown[]
    } else {
      const next_val = (cur as Record<string, unknown>)[seg]
      if (next_val == null || typeof next_val !== 'object') {
        (cur as Record<string, unknown>)[seg] = nextIsIndex ? [] : {}
      }
      cur = (cur as Record<string, unknown>)[seg] as Record<string, unknown> | unknown[]
    }
  }
  const lastSeg = path[path.length - 1]
  if (Array.isArray(cur)) cur[Number(lastSeg)] = value
  else (cur as Record<string, unknown>)[lastSeg] = value
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('items' in o && Array.isArray(o.items)) return (o.items as unknown[]).length === 0
    if ('label' in o || 'url' in o) {
      return !o.label && !o.url
    }
    return Object.keys(o).length === 0
  }
  return false
}

// ── Misc helpers ─────────────────────────────────────────────────────

function looksLikeImageUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) && /\.(jpe?g|png|gif|webp|svg|avif)(\?|#|$)/i.test(s)
}

function previewValue(v: unknown): string {
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 77) + '…' : v
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.label === 'string') return `Button: ${o.label}`
    if (Array.isArray(o.items)) return `[${o.items.length} items]`
    return `{${Object.keys(o).slice(0, 3).join(', ')}…}`
  }
  return String(v)
}

function slotLabel(slot: WebSlotDef): string {
  if (slot.label) return slot.label
  if (slot.layer_name) return slot.layer_name
  return titleize(slot.key)
}

function groupLabel(group: WebGroupDef): string {
  if (group.layer_name) return group.layer_name
  return titleize(group.key)
}

function firstItemTextKey(group: WebGroupDef): string | null {
  if (!Array.isArray(group.item_schema)) return null
  for (const f of group.item_schema) {
    if (f.kind === 'slot' && (f.type === 'text' || f.type === 'richtext')) {
      return f.key
    }
  }
  return null
}

function titleize(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function pickStringField(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => {
    if (c === '&') return '&amp;'
    if (c === '<') return '&lt;'
    if (c === '>') return '&gt;'
    if (c === '"') return '&quot;'
    return '&#39;'
  })
}

// Re-export CtaValue so callers don't need a separate import.
export type { CtaValue }
