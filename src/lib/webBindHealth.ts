/**
 * Per-section bind health diagnosis.
 *
 * Walks a section's template against its current field_values and
 * reports:
 *   • Total / filled / empty slot counts (text-bearing only — image
 *     slots aren't bind-health business; they're an asset handoff
 *     concern surfaced in the Contents chip elsewhere).
 *   • Empty slot rows with optional "pull from nested item" hints.
 *     When a top-level `description` is blank but the section's
 *     `card[0].description` (or `tab[0].description`) carries text,
 *     the panel offers a one-click pull so the strategist can use
 *     the nested content as the section intro.
 *
 * Pure — no React, no Supabase. SectionDetailsPanel calls this once
 * per render, BindHealthPanel renders the result, and onPull writes
 * the suggested value into field_values.
 */
import { canonicalAliasFor } from './briefKeyAliases'
import type {
  WebContentTemplate, WebFieldDef, WebSlotDef,
} from '../types/database'

export interface NestedPullSuggestion {
  /** Display label for the source location ("Tabs · item 1"). */
  sourceLabel: string
  /** Plain-text preview (≤120 chars) of what would be pulled. */
  preview: string
  /** Raw value (could be HTML if the source slot is richtext). */
  value: unknown
  /** Source slot type — drives whether we wrap in <p> on pull. */
  sourceType: WebSlotDef['type']
}

export interface EmptySlotRow {
  slotKey:        string
  slotLabel:      string
  slotType:       WebSlotDef['type']
  required:       boolean
  suggestions:    NestedPullSuggestion[]
}

export interface BindHealth {
  /** Top-level text/richtext slots only — the headline "items bound"
   *  counter the panel has shown since v1. */
  totalText:      number
  filledText:     number
  emptyText:      number
  emptyRows:      EmptySlotRow[]
  /** Recursive count of EVERY bindable slot the template exposes —
   *  including image slots, CTAs, and slots nested inside group items
   *  (counted per actual item instance, not per item_schema entry).
   *  Surfaces the gap between "the section's intro is bound" and
   *  "every card in the section's grid has copy + an image", which
   *  the text-only counter masked entirely. */
  totalAllFields:  number
  filledAllFields: number
  emptyAllFields:  number
}

/** Strip HTML tags + collapse whitespace for previews + emptiness checks. */
function plainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTextSlot(field: WebFieldDef): field is WebSlotDef {
  if (field.kind !== 'slot') return false
  return field.type === 'text' || field.type === 'richtext'
}

function slotLabel(slot: WebSlotDef): string {
  if (slot.label) return slot.label
  return slot.layer_name ?? slot.key
}

function preview(s: string, limit = 120): string {
  if (s.length <= limit) return s
  return s.slice(0, limit - 1).trimEnd() + '…'
}

/** For a given empty top-level slot, collect candidate values from
 *  nested group items whose own slot shares the same canonical key.
 *  Returns at most 3 suggestions, ordered by source position. */
function collectNestedSuggestions(
  emptySlot: WebSlotDef,
  fields: ReadonlyArray<WebFieldDef>,
  values: Record<string, unknown>,
): NestedPullSuggestion[] {
  const targetCanon = canonicalAliasFor(emptySlot.key)
  const out: NestedPullSuggestion[] = []
  for (const field of fields) {
    if (field.kind !== 'group') continue
    const groupValue = values[field.key]
    if (!Array.isArray(groupValue) && !(groupValue && typeof groupValue === 'object')) continue
    // Items live as direct array OR as { items: [...] } on palette
    // groups. Both shapes get the same downstream treatment.
    const items: Array<Record<string, unknown>> = Array.isArray(groupValue)
      ? (groupValue as Array<Record<string, unknown>>)
      : Array.isArray((groupValue as { items?: unknown }).items)
        ? ((groupValue as { items: Array<Record<string, unknown>> }).items)
        : []
    if (items.length === 0) continue
    const itemSchema = Array.isArray(field.item_schema) ? field.item_schema : []
    for (let i = 0; i < items.length && out.length < 3; i++) {
      const item = items[i]
      if (!item || typeof item !== 'object') continue
      // Find an item slot whose canonical matches the empty slot's.
      const matchedSlot = itemSchema.find((f): f is WebSlotDef =>
        f.kind === 'slot' && canonicalAliasFor(f.key) === targetCanon,
      )
      if (!matchedSlot) continue
      const raw = item[matchedSlot.key]
      const text = plainText(raw)
      if (!text) continue
      const groupLabel = field.layer_name ?? field.key
      out.push({
        sourceLabel: `${groupLabel} · item ${i + 1}`,
        preview: preview(text),
        value: raw,
        sourceType: matchedSlot.type,
      })
    }
  }
  return out
}

/** True when a text/richtext slot value is missing or whitespace-only.
 *  Richtext values are also empty when they only contain markup.
 *  Used for the top-level "text items bound" counter — non-text slots
 *  return false here so they don't show up as empty rows. */
function isSlotEmpty(slot: WebSlotDef, value: unknown): boolean {
  if (value == null) return true
  if (typeof value !== 'string') return false        // images / bools / etc.
  return plainText(value).length === 0
}

/** True when ANY slot type's value reads as unbound. Mirrors the
 *  preview pipeline's emptiness checks (placeholder images, blank
 *  text, missing CTA url+label) so the brixies-fields counter reflects
 *  what a viewer would actually see as a gap. */
function isAnyFieldEmpty(slot: WebSlotDef, value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return true
    if (slot.type === 'image') {
      // placehold.co + Brixies's via.placeholder.com fallbacks aren't
      // a real bind — count them as empty.
      return /placehold\.co|placeholder\.com/i.test(trimmed)
    }
    if (slot.type === 'text' || slot.type === 'richtext') {
      return plainText(value).length === 0
    }
    return false
  }
  if (typeof value === 'object') {
    // CTA / link shape: { label, url } — empty when neither resolves.
    const obj = value as { label?: unknown; url?: unknown; src?: unknown }
    if ('src' in obj) {
      const src = typeof obj.src === 'string' ? obj.src.trim() : ''
      if (!src) return true
      return /placehold\.co|placeholder\.com/i.test(src)
    }
    if ('url' in obj || 'label' in obj) {
      const label = typeof obj.label === 'string' ? plainText(obj.label) : ''
      const url   = typeof obj.url   === 'string' ? obj.url.trim()       : ''
      return !label && !url
    }
    return false
  }
  return false
}

/** Walk every slot the template exposes — top-level + every group's
 *  item_schema, instance-counted against the actual items in
 *  field_values — and return {total, filled}. The instance count is
 *  important: a "cards" group with 3 cards × 2 slots = 6 fields, not
 *  2 (the schema entry count) and not 0 (the top-level field count). */
function countAllFields(
  fields: ReadonlyArray<WebFieldDef>,
  values: Record<string, unknown>,
): { total: number; filled: number } {
  let total = 0
  let filled = 0
  for (const field of fields) {
    if (field.kind === 'slot') {
      total++
      if (!isAnyFieldEmpty(field, values[field.key])) filled++
      continue
    }
    if (field.kind !== 'group') continue
    const groupValue = values[field.key]
    const items: Array<Record<string, unknown>> = Array.isArray(groupValue)
      ? (groupValue as Array<Record<string, unknown>>)
      : (groupValue && typeof groupValue === 'object'
            && Array.isArray((groupValue as { items?: unknown }).items)
          ? ((groupValue as { items: Array<Record<string, unknown>> }).items)
          : [])
    const itemSchema = Array.isArray(field.item_schema) ? field.item_schema : []
    if (itemSchema.length === 0) continue
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const sub = countAllFields(itemSchema, item)
      total  += sub.total
      filled += sub.filled
    }
  }
  return { total, filled }
}

export function computeBindHealth(
  template: WebContentTemplate | null,
  fieldValues: Record<string, unknown>,
): BindHealth {
  if (!template || !Array.isArray(template.fields)) {
    return {
      totalText: 0, filledText: 0, emptyText: 0, emptyRows: [],
      totalAllFields: 0, filledAllFields: 0, emptyAllFields: 0,
    }
  }
  let total = 0
  let filled = 0
  const emptyRows: EmptySlotRow[] = []
  for (const field of template.fields) {
    if (!isTextSlot(field)) continue
    total++
    const value = fieldValues[field.key]
    if (!isSlotEmpty(field, value)) { filled++; continue }
    emptyRows.push({
      slotKey:     field.key,
      slotLabel:   slotLabel(field),
      slotType:    field.type,
      required:    field.required === true,
      suggestions: collectNestedSuggestions(field, template.fields, fieldValues),
    })
  }
  const allFields = countAllFields(template.fields, fieldValues)
  return {
    totalText:       total,
    filledText:      filled,
    emptyText:       total - filled,
    emptyRows,
    totalAllFields:  allFields.total,
    filledAllFields: allFields.filled,
    emptyAllFields:  allFields.total - allFields.filled,
  }
}
