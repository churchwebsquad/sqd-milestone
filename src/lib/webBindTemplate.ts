/**
 * Template binding helpers.
 *
 * When a freehand section is bound to a Brixies template, three sources
 * compete to fill the template's slots:
 *   1. The page brief's structured `fields` object (highest fidelity —
 *      cowork already chose key names that often match template slots).
 *   2. The freehand body HTML (heuristic fallback — h1 → heading slot,
 *      first <p> → body slot, lists → group items).
 *   3. Nothing (slot stays empty for the strategist to fill).
 *
 * Anything the brief carried that didn't land in a slot stays accessible
 * via the overflow stash, so re-binding to a different variant never
 * loses content.
 */

import type {
  WebContentTemplate, WebFieldDef, WebSlotDef, WebGroupDef,
} from '../types/database'
import type { PageBrief, BriefSection } from './webPageBrief'

export interface BindMappingResult {
  /** field_values to write to the bound section. */
  field_values: Record<string, unknown>
  /** Template slot keys (dotted path for groups) that got a value. */
  matched_slots: string[]
  /** Template slot keys that ended up empty. */
  missing_slots: string[]
  /** Brief field keys that didn't map to any slot. */
  unmatched_brief_keys: string[]
}

// ── Key normalization / synonyms ────────────────────────────────────

/** Cowork (and Brixies) use a handful of canonical names per concept.
 *  Each canonical key here lists every variant that should match it. */
const SYNONYM_GROUPS: string[][] = [
  ['heading', 'h1', 'h2', 'h3', 'title', 'headline'],
  ['tagline', 'eyebrow', 'kicker', 'overline', 'pretitle'],
  ['body', 'description', 'copy', 'text', 'paragraph', 'subtext', 'subheading', 'subhead'],
  ['image', 'hero_image', 'photo', 'illustration', 'picture'],
  ['images', 'photos', 'gallery'],
  ['cta', 'button', 'link', 'action'],
  ['ctas', 'buttons', 'links', 'actions'],
  ['cards', 'items', 'features', 'tiles', 'blocks'],
  ['events', 'list', 'rows'],
  ['quote', 'testimonial'],
  ['author', 'author_name', 'name', 'attribution'],
]

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[\s_\-]/g, '')
}

/** Build a synonym lookup once. Maps every normalized variant to its
 *  canonical key so `matchesSlot()` runs O(1). */
const SYNONYM_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const group of SYNONYM_GROUPS) {
    const canonical = normalizeKey(group[0])
    for (const variant of group) m.set(normalizeKey(variant), canonical)
  }
  return m
})()

function canonical(k: string): string {
  const n = normalizeKey(k)
  return SYNONYM_INDEX.get(n) ?? n
}

/** Two keys "match" if their canonical forms agree. */
function keysMatch(a: string, b: string): boolean {
  return canonical(a) === canonical(b)
}

// ── Brief / section lookup ──────────────────────────────────────────

/** Pull the brief section that matches `sectionId` out of a page's
 *  stored brief, or null. */
export function findBriefSection(
  brief: PageBrief | null | undefined,
  sectionId: string | null | undefined,
): BriefSection | null {
  if (!brief || !sectionId) return null
  const sections = Array.isArray(brief.sections) ? brief.sections : []
  return sections.find(s => s.section_id === sectionId) ?? null
}

/** Pull the `Section ID: <id>` line out of a web_sections.notes blob. */
export function extractSectionIdFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null
  const m = notes.match(/^\s*Section ID:\s*(.+)$/im)
  return m ? m[1].trim() : null
}

// ── Brief fields → template field_values ────────────────────────────

/** Coerce a brief value to the shape the slot's field type wants.
 *  Strings stay strings; CTAs accept `{ label, url }` or `{ label, target }`;
 *  unknown shapes fall back to JSON.stringify so nothing is silently lost. */
function coerceForSlot(slot: WebSlotDef, briefValue: unknown): unknown {
  if (briefValue == null) return null
  switch (slot.type) {
    case 'cta': {
      if (typeof briefValue === 'object' && briefValue !== null) {
        const obj = briefValue as Record<string, unknown>
        return {
          label: typeof obj.label === 'string' ? obj.label : '',
          url: typeof obj.url === 'string' ? obj.url
            : typeof obj.target === 'string' ? obj.target
            : '',
        }
      }
      if (typeof briefValue === 'string') return { label: briefValue, url: '' }
      return { label: '', url: '' }
    }
    case 'boolean':
      return briefValue === true || briefValue === 'true'
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'datetime':
    case 'image':
      if (typeof briefValue === 'string') return briefValue
      if (typeof briefValue === 'number') return String(briefValue)
      return ''
    case 'richtext':
      // Pass HTML through; wrap plain text in a <p>.
      if (typeof briefValue !== 'string') return ''
      if (/<[a-z][^>]*>/i.test(briefValue)) return briefValue
      return `<p>${escapeHtml(briefValue)}</p>`
    default:
      return typeof briefValue === 'string' ? briefValue : ''
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;'
    : c === '<' ? '&lt;'
    : c === '>' ? '&gt;'
    : c === '"' ? '&quot;'
    : '&#39;')
}

/** For a group, the brief value should be an array — but cowork sometimes
 *  ships a single object when default_count is 1, or a Record indexed by
 *  numeric keys. Normalize. */
function asGroupItems(briefValue: unknown): Record<string, unknown>[] {
  if (Array.isArray(briefValue)) {
    return briefValue.filter((v): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v))
  }
  if (typeof briefValue === 'object' && briefValue !== null) {
    const obj = briefValue as Record<string, unknown>
    const numericKeys = Object.keys(obj).filter(k => /^\d+$/.test(k)).sort((a, b) => +a - +b)
    if (numericKeys.length > 0) {
      return numericKeys
        .map(k => obj[k])
        .filter((v): v is Record<string, unknown> =>
          typeof v === 'object' && v !== null && !Array.isArray(v))
    }
    // Single object fallback → treat as one-item group.
    return [obj]
  }
  return []
}

function mapItemFields(
  itemSchema: WebFieldDef[],
  briefItem: Record<string, unknown>,
  pathPrefix: string,
  result: { matched: string[]; missing: string[]; unmatched: string[] },
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const usedBriefKeys = new Set<string>()

  for (const field of itemSchema) {
    const briefKey = findMatchingBriefKey(field.key, briefItem, usedBriefKeys)
    const slotPath = `${pathPrefix}.${field.key}`
    if (briefKey == null) {
      result.missing.push(slotPath)
      continue
    }
    usedBriefKeys.add(briefKey)
    if (field.kind === 'slot') {
      out[field.key] = coerceForSlot(field, briefItem[briefKey])
      result.matched.push(slotPath)
    } else {
      const subItems = asGroupItems(briefItem[briefKey])
      const subResult = subItems.map((sub, i) =>
        mapItemFields(field.item_schema, sub, `${slotPath}[${i}]`, result))
      out[field.key] = subResult
      result.matched.push(slotPath)
    }
  }

  // Anything in the brief item that didn't get consumed → unmatched.
  for (const k of Object.keys(briefItem)) {
    if (!usedBriefKeys.has(k)) result.unmatched.push(`${pathPrefix}.${k}`)
  }
  return out
}

function findMatchingBriefKey(
  slotKey: string,
  briefObj: Record<string, unknown>,
  alreadyUsed: Set<string>,
): string | null {
  // Pass 1: exact key (case + separator insensitive).
  for (const k of Object.keys(briefObj)) {
    if (alreadyUsed.has(k)) continue
    if (normalizeKey(k) === normalizeKey(slotKey)) return k
  }
  // Pass 2: synonym match.
  for (const k of Object.keys(briefObj)) {
    if (alreadyUsed.has(k)) continue
    if (keysMatch(k, slotKey)) return k
  }
  return null
}

/** Walk the template's `fields`, pulling values from the brief section's
 *  `fields` object wherever a key matches (with synonym tolerance). */
export function mapBriefToTemplate(
  briefSection: BriefSection | null,
  template: WebContentTemplate,
): BindMappingResult {
  const briefFields =
    briefSection && typeof briefSection.fields === 'object' && briefSection.fields !== null
      ? briefSection.fields as Record<string, unknown>
      : {}

  const tracker = { matched: [] as string[], missing: [] as string[], unmatched: [] as string[] }
  const usedKeys = new Set<string>()
  const out: Record<string, unknown> = {}

  for (const field of template.fields) {
    const briefKey = findMatchingBriefKey(field.key, briefFields, usedKeys)
    if (briefKey == null) {
      tracker.missing.push(field.key)
      continue
    }
    usedKeys.add(briefKey)
    if (field.kind === 'slot') {
      out[field.key] = coerceForSlot(field, briefFields[briefKey])
      tracker.matched.push(field.key)
    } else {
      const items = asGroupItems(briefFields[briefKey])
      const mappedItems = items.map((item, i) =>
        mapItemFields(field.item_schema, item, `${field.key}[${i}]`, tracker))
      out[field.key] = mappedItems
      tracker.matched.push(field.key)
    }
  }

  // Brief keys not consumed at the section level — surface as unmatched.
  for (const k of Object.keys(briefFields)) {
    if (!usedKeys.has(k)) tracker.unmatched.push(k)
  }

  return {
    field_values: out,
    matched_slots: tracker.matched,
    missing_slots: tracker.missing,
    unmatched_brief_keys: tracker.unmatched,
  }
}

// ── Body HTML → template slots (fallback) ───────────────────────────

/** Parse a freehand HTML body and pull straightforward chunks into
 *  template slots. Heuristics, not magic — works best on simple
 *  text/richtext slots; groups are left untouched (the brief path
 *  handles those, or the strategist routes manually). */
export function mapHtmlBodyToTemplate(
  html: string,
  template: WebContentTemplate,
): { field_values: Record<string, unknown>; matched_slots: string[] } {
  if (typeof window === 'undefined' || !html) {
    return { field_values: {}, matched_slots: [] }
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return { field_values: {}, matched_slots: [] }

  const children = Array.from(root.children)
  const segments = {
    h1: [] as string[],
    h2: [] as string[],
    h3plus: [] as string[],
    p: [] as string[],
    listHtml: [] as string[],
  }
  for (const el of children) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'h1') segments.h1.push(el.textContent ?? '')
    else if (tag === 'h2') segments.h2.push(el.textContent ?? '')
    else if (tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      segments.h3plus.push(el.textContent ?? '')
    } else if (tag === 'p') segments.p.push(el.outerHTML)
    else if (tag === 'ul' || tag === 'ol') segments.listHtml.push(el.outerHTML)
  }

  const out: Record<string, unknown> = {}
  const matched: string[] = []

  const consumeFirst = (arr: string[]): string | null => arr.length ? arr.shift()! : null

  for (const field of template.fields) {
    if (field.kind !== 'slot') continue  // groups: brief-path territory
    const key = canonical(field.key)

    // Heading-shaped slots
    if (key === 'heading') {
      const v = consumeFirst(segments.h1) ?? consumeFirst(segments.h2)
      if (v) { out[field.key] = v; matched.push(field.key); continue }
    }
    if (key === 'tagline') {
      const v = consumeFirst(segments.h2) ?? consumeFirst(segments.h3plus)
      if (v) { out[field.key] = v; matched.push(field.key); continue }
    }
    if (key === 'body') {
      if (field.type === 'richtext') {
        const parts = segments.p.splice(0)
        const lists = segments.listHtml.splice(0)
        const joined = [...parts, ...lists].join('')
        if (joined) { out[field.key] = joined; matched.push(field.key); continue }
      } else {
        const v = consumeFirst(segments.p)
        if (v) {
          const t = stripTags(v)
          out[field.key] = t; matched.push(field.key); continue
        }
      }
    }
  }

  return { field_values: out, matched_slots: matched }
}

function stripTags(html: string): string {
  if (typeof window === 'undefined') return html
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent?.trim() ?? ''
}

// ── Combined binding flow ───────────────────────────────────────────

export interface ComposedBindResult {
  field_values: Record<string, unknown>
  source_report: {
    matched_from_brief: string[]
    matched_from_body: string[]
    missing_slots: string[]
    unmatched_brief_keys: string[]
  }
}

// ── Variant ranking ─────────────────────────────────────────────────

export interface RankedVariant {
  template: WebContentTemplate
  score: number
  rationale: string
}

/** Deterministic scoring — runs client-side, no network. Ranks candidates
 *  by how well their slot/group shape matches the brief's `fields` object.
 *  Used to sort the catalog before the strategist scrolls; the AI re-rank
 *  endpoint can refine on top with voice/intent signals. */
export function rankVariantsByBrief(
  briefSection: BriefSection | null,
  candidates: WebContentTemplate[],
): RankedVariant[] {
  const briefFields = briefSection?.fields && typeof briefSection.fields === 'object'
    ? briefSection.fields as Record<string, unknown>
    : {}
  const briefKeys = Object.keys(briefFields)
  const briefGroups: Array<{ key: string; count: number }> = []
  for (const [k, v] of Object.entries(briefFields)) {
    if (Array.isArray(v)) briefGroups.push({ key: k, count: v.length })
  }
  const briefSlotCount = briefKeys.length - briefGroups.length

  return candidates.map(tpl => {
    const slots = tpl.fields.filter(f => f.kind === 'slot') as WebSlotDef[]
    const groups = tpl.fields.filter(f => f.kind === 'group') as WebGroupDef[]

    // Score = mapped brief keys + group-count fit − unmapped-on-each-side penalty.
    let score = 0
    const reasons: string[] = []

    const usedBrief = new Set<string>()
    let mappedSlots = 0
    for (const slot of slots) {
      const bk = findMatchingBriefKey(slot.key, briefFields, usedBrief)
      if (bk) { usedBrief.add(bk); mappedSlots++ }
    }
    score += mappedSlots * 3
    if (mappedSlots > 0) reasons.push(`${mappedSlots} slot${mappedSlots === 1 ? '' : 's'} match brief`)

    let groupBonus = 0
    for (const group of groups) {
      const briefGroup = briefGroups.find(bg => keysMatch(bg.key, group.key))
      if (briefGroup) {
        // Closer to default_count = better.
        const delta = Math.abs(group.default_count - briefGroup.count)
        groupBonus += Math.max(0, 5 - delta)
        if (delta === 0) reasons.push(`${group.key} group fits ${briefGroup.count} items exactly`)
        else if (delta <= 2) reasons.push(`${group.key} group close (${group.default_count} vs ${briefGroup.count})`)
      }
    }
    score += groupBonus

    // Light penalty for slot-count divergence — keeps over-large templates
    // from edging out a tight fit when brief is sparse.
    const slotDelta = Math.abs(slots.length - briefSlotCount)
    score -= Math.min(slotDelta, 5)

    return {
      template: tpl,
      score,
      rationale: reasons.length > 0 ? reasons.join(' · ') : 'No direct field overlap; rank by slot-count proximity',
    }
  }).sort((a, b) => b.score - a.score)
}

/** Compose brief mapping + body HTML mapping into final field_values.
 *  Brief wins on conflict. The original body HTML is always stashed in
 *  `__overflow_html` by the caller (PagesWorkspace.bindSection) so the
 *  strategist can verify nothing was dropped. */
export function composeBind(
  briefSection: BriefSection | null,
  freehandBodyHtml: string,
  template: WebContentTemplate,
): ComposedBindResult {
  const fromBrief = mapBriefToTemplate(briefSection, template)
  const fromBody = mapHtmlBodyToTemplate(freehandBodyHtml, template)

  // Brief wins; body fills only the still-missing slots.
  const merged: Record<string, unknown> = { ...fromBrief.field_values }
  const matchedFromBody: string[] = []
  for (const key of fromBody.matched_slots) {
    const briefVal = merged[key]
    const briefEmpty = briefVal == null
      || briefVal === ''
      || (typeof briefVal === 'object' && briefVal !== null && Object.keys(briefVal as object).length === 0)
    if (briefEmpty) {
      merged[key] = fromBody.field_values[key]
      matchedFromBody.push(key)
    }
  }

  // Recompute missing after body backfill.
  const stillMissing = fromBrief.missing_slots.filter(k => !matchedFromBody.includes(k))

  return {
    field_values: merged,
    source_report: {
      matched_from_brief: fromBrief.matched_slots,
      matched_from_body: matchedFromBody,
      missing_slots: stillMissing,
      unmatched_brief_keys: fromBrief.unmatched_brief_keys,
    },
  }
}
