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
 *  Each canonical key here lists every variant that should match it.
 *  CTA / buttons / cards are intentionally merged (singular + plural,
 *  brief variants like primary_cta / secondary_cta / cta_inline) so a
 *  template's `buttons` group matches a brief's `primary_cta` + `cta`,
 *  and a template's `cards` group matches `items` / `features`. */
const SYNONYM_GROUPS: string[][] = [
  ['heading', 'h', 'h1', 'h2', 'h3', 'title', 'headline'],
  ['tagline', 'eyebrow', 'kicker', 'overline', 'pretitle'],
  ['body', 'd', 'description', 'copy', 'text', 'paragraph', 'subtext', 'subheading', 'subhead', 'intro'],
  ['image', 'hero_image', 'photo', 'illustration', 'picture'],
  ['images', 'photos', 'gallery'],
  ['cta', 'ctas', 'button', 'buttons', 'link', 'links', 'action', 'actions', 'primary_cta', 'secondary_cta', 'cta_inline'],
  ['cards', 'card', 'items', 'item', 'features', 'feature', 'tiles', 'tile', 'blocks', 'block', 'list', 'rows'],
  ['events', 'event'],
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
    const canonicalKey = normalizeKey(group[0])
    for (const variant of group) m.set(normalizeKey(variant), canonicalKey)
  }
  return m
})()

/** Map a key (potentially scope-suffixed/prefixed like `heading_card` or
 *  `primary_cta`) to its canonical concept. Tries:
 *    1. Direct synonym lookup on the normalized key.
 *    2. Strip trailing scope segments (heading_card → heading).
 *    3. Strip leading scope segments (primary_cta → cta).
 *  Falls back to the normalized key when nothing matches. */
function canonical(k: string): string {
  const n = normalizeKey(k)
  if (SYNONYM_INDEX.has(n)) return SYNONYM_INDEX.get(n)!
  const parts = k.toLowerCase().split(/[_\s-]+/).filter(Boolean)
  if (parts.length > 1) {
    // Suffix-strip (drop from the right): heading_card, buttons_card.
    for (let cut = 1; cut < parts.length; cut++) {
      const candidate = normalizeKey(parts.slice(0, parts.length - cut).join(''))
      if (SYNONYM_INDEX.has(candidate)) return SYNONYM_INDEX.get(candidate)!
    }
    // Prefix-strip (drop from the left): primary_cta, secondary_cta.
    for (let cut = 1; cut < parts.length; cut++) {
      const candidate = normalizeKey(parts.slice(cut).join(''))
      if (SYNONYM_INDEX.has(candidate)) return SYNONYM_INDEX.get(candidate)!
    }
  }
  return n
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

/** True when an object looks like a CTA value — has a `label` and either
 *  a `target` or `url`. Used by mapItemFields to auto-route the whole
 *  briefItem into a single cta-typed slot when the item schema models a
 *  CTA as a single slot rather than label/url field pairs. */
function looksLikeCta(v: unknown): v is { label: string; url?: string; target?: string } {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  return typeof obj.label === 'string'
    && (typeof obj.url === 'string' || typeof obj.target === 'string')
}

function mapItemFields(
  itemSchema: WebFieldDef[],
  briefItem: Record<string, unknown>,
  pathPrefix: string,
  result: { matched: string[]; missing: string[]; unmatched: string[] },
): Record<string, unknown> {
  // Special case: a single CTA-shape briefItem ({label, target}) routed
  // into a schema whose single slot is type='cta' — bind the whole item
  // to that slot. This is the buttons-group flow: each item in the brief
  // is a CTA object, and Brixies models each card's button as one
  // type='cta' slot rather than separate label/url field pairs.
  const ctaSlot = itemSchema.find(
    (f): f is WebSlotDef => f.kind === 'slot' && f.type === 'cta'
  )
  if (ctaSlot && looksLikeCta(briefItem) && itemSchema.length === 1) {
    return { [ctaSlot.key]: coerceForSlot(ctaSlot, briefItem) }
  }

  const out: Record<string, unknown> = {}
  const usedBriefKeys = new Set<string>()

  for (const field of itemSchema) {
    const briefKey = findMatchingBriefKey(field.key, briefItem, usedBriefKeys)
    const slotPath = `${pathPrefix}.${field.key}`
    if (briefKey == null) {
      // For cta-typed slots, also accept the whole briefItem when it
      // looks like a CTA — even when the item_schema has other slots
      // (some Brixies templates pair a cta slot with a label scope text).
      if (field.kind === 'slot' && field.type === 'cta' && looksLikeCta(briefItem)) {
        out[field.key] = coerceForSlot(field, briefItem)
        result.matched.push(slotPath)
        continue
      }
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
    if (field.kind === 'slot') {
      const briefKey = findMatchingBriefKey(field.key, briefFields, usedKeys)
      if (briefKey == null) {
        tracker.missing.push(field.key)
        continue
      }
      usedKeys.add(briefKey)
      out[field.key] = coerceForSlot(field, briefFields[briefKey])
      tracker.matched.push(field.key)
      continue
    }
    // Group: first try a single matching brief key whose value is an
    // array. If that's absent OR not an array, collect every unused
    // brief key whose canonical matches the group's canonical and
    // treat each as one item. This handles the common paired shape
    // `primary_cta` + `secondary_cta` → template `buttons` group.
    const directKey = findMatchingBriefKey(field.key, briefFields, usedKeys)
    let items: Record<string, unknown>[] = []
    if (directKey != null && Array.isArray(briefFields[directKey])) {
      usedKeys.add(directKey)
      items = asGroupItems(briefFields[directKey])
    } else {
      const groupCanon = canonical(field.key)
      const matched: string[] = []
      for (const k of Object.keys(briefFields)) {
        if (usedKeys.has(k)) continue
        if (canonical(k) === groupCanon) matched.push(k)
      }
      if (matched.length > 0) {
        for (const k of matched) {
          usedKeys.add(k)
          const v = briefFields[k]
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            items.push(v as Record<string, unknown>)
          } else if (Array.isArray(v)) {
            items.push(...asGroupItems(v))
          }
        }
      } else if (directKey != null) {
        // Single non-array match → wrap as one item.
        usedKeys.add(directKey)
        items = asGroupItems(briefFields[directKey])
      }
    }
    if (items.length === 0) {
      tracker.missing.push(field.key)
      continue
    }
    const mappedItems = items.map((item, i) =>
      mapItemFields(field.item_schema, item, `${field.key}[${i}]`, tracker))
    out[field.key] = mappedItems
    tracker.matched.push(field.key)
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

interface ParsedSubBlock {
  heading: string
  /** All non-heading content between this heading and the next, as HTML. */
  bodyHtml: string
  /** Same content, stripped to plain text. */
  bodyText: string
  /** First link found in the block (if any) — routed to a cta slot. */
  cta: { label: string; url: string } | null
  /** First image src found in the block (if any) — routed to an image slot. */
  imageUrl: string | null
}

interface ParsedBody {
  /** The section's own heading (top-level h1, or the first h2 when there
   *  are no h2-shaped sub-blocks). */
  sectionHeading: string | null
  /** Any non-section, non-sub-block heading that reads as a tagline. */
  tagline: string | null
  /** Content above the first sub-block — section intro / body copy. */
  intro: { html: string; text: string }
  /** Parallel sub-blocks detected at h2 or h3 level. */
  subBlocks: ParsedSubBlock[]
  /** Which tag was used as the sub-block boundary (h2 / h3 / null). */
  splitTag: 'h2' | 'h3' | null
  /** Section-level CTAs — button-shaped `<p><a>label</a></p>` blocks
   *  pulled out of the intro region. The brief importer renders
   *  primary/secondary CTAs in exactly this shape, so detecting them
   *  lets the bind flow recover URLs even when the field key matching
   *  doesn't find them on the brief object. */
  sectionCtas: Array<{ label: string; url: string }>
}

/** Parse a freehand body into a section-shape: optional heading +
 *  optional tagline + intro body + N parallel sub-blocks. The sub-blocks
 *  are detected by repetition: if there are ≥2 h2s (or ≥2 h3s), those are
 *  card-shaped boundaries, and the content between them becomes each
 *  card's body. */
function parseBodyForBlocks(html: string): ParsedBody {
  const empty: ParsedBody = {
    sectionHeading: null,
    tagline: null,
    intro: { html: '', text: '' },
    subBlocks: [],
    splitTag: null,
    sectionCtas: [],
  }
  if (typeof window === 'undefined' || !html) return empty
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return empty
  const children = Array.from(root.children)

  // Count headings at each level. Sub-blocks need 2+ siblings of the same
  // heading level to read as parallel.
  let h2Count = 0
  let h3Count = 0
  for (const el of children) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'h2') h2Count++
    else if (tag === 'h3') h3Count++
  }
  // Pick the split tag — prefer h2 (the natural sub-block level); fall
  // back to h3 only when there are no h2s.
  let splitTag: 'h2' | 'h3' | null = null
  if (h2Count >= 2) splitTag = 'h2'
  else if (h3Count >= 2 && h2Count === 0) splitTag = 'h3'

  const sectionHeading: string | null = null
  let tagline: string | null = null
  const introNodes: Element[] = []
  const blocks: { headingEl: Element; bodyEls: Element[] }[] = []

  // Walk children, splitting at the chosen split tag.
  let current: { headingEl: Element; bodyEls: Element[] } | null = null
  let pickedSectionH1 = false
  let pickedSectionFallback = false
  let result: ParsedBody = empty

  for (const el of children) {
    const tag = el.tagName.toLowerCase()
    if (splitTag && tag === splitTag) {
      // Sub-block boundary.
      if (current) blocks.push(current)
      current = { headingEl: el, bodyEls: [] }
      continue
    }
    if (current) {
      current.bodyEls.push(el)
    } else {
      // Pre-block content — section heading, tagline, intro.
      if (tag === 'h1' && !pickedSectionH1) {
        ;(result as { sectionHeading: string | null }).sectionHeading = el.textContent?.trim() ?? null
        pickedSectionH1 = true
        continue
      }
      // If we don't split on h2 (only one h2 in the doc), treat that h2 as
      // the section heading when no h1 was found.
      if (splitTag !== 'h2' && tag === 'h2' && !pickedSectionH1 && !pickedSectionFallback) {
        ;(result as { sectionHeading: string | null }).sectionHeading = el.textContent?.trim() ?? null
        pickedSectionFallback = true
        continue
      }
      // Smaller heading before any sub-block reads as a tagline.
      if (tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        if (tagline == null) tagline = el.textContent?.trim() ?? null
        continue
      }
      introNodes.push(el)
    }
  }
  if (current) blocks.push(current)

  // Pull section-level CTAs out of intro nodes — a `<p>` whose only
  // meaningful child is an anchor (i.e. the link IS the whole paragraph)
  // reads as a button. Inline links inside prose stay in the body.
  const sectionCtas: Array<{ label: string; url: string }> = []
  const introBodyNodes: Element[] = []
  for (const n of introNodes) {
    if (n.tagName.toLowerCase() === 'p') {
      const anchors = n.querySelectorAll('a')
      if (anchors.length === 1) {
        const a = anchors[0]
        const pText = (n.textContent ?? '').trim()
        const aText = (a.textContent ?? '').trim()
        // Anchor text consumes (effectively) the whole paragraph → button.
        if (aText && pText && (aText.length / pText.length) >= 0.8) {
          sectionCtas.push({
            label: aText.replace(/\s*[→›>]+\s*$/, '').trim(),
            url: a.getAttribute('href') ?? '',
          })
          continue
        }
      }
    }
    introBodyNodes.push(n)
  }

  const introHtml = introBodyNodes.map(n => n.outerHTML).join('')
  const introText = introBodyNodes.map(n => (n.textContent ?? '').trim()).filter(Boolean).join('\n\n')

  const subBlocks: ParsedSubBlock[] = blocks.map(b => {
    const headingText = b.headingEl.textContent?.trim() ?? ''
    const bodyHtml = b.bodyEls.map(n => n.outerHTML).join('')
    const bodyText = b.bodyEls.map(n => (n.textContent ?? '').trim()).filter(Boolean).join('\n\n')
    // First anchor inside the body becomes the CTA.
    let cta: { label: string; url: string } | null = null
    for (const n of b.bodyEls) {
      const a = n.tagName.toLowerCase() === 'a' ? n : n.querySelector?.('a')
      if (a) {
        const url = a.getAttribute('href') ?? ''
        const label = (a.textContent ?? '').trim()
        if (label) { cta = { label, url } ; break }
      }
    }
    // First image src becomes the image slot.
    let imageUrl: string | null = null
    for (const n of b.bodyEls) {
      const img = n.tagName.toLowerCase() === 'img' ? n : n.querySelector?.('img')
      if (img) { imageUrl = img.getAttribute('src') ?? null; if (imageUrl) break }
    }
    return { heading: headingText, bodyHtml, bodyText, cta, imageUrl }
  })

  result = {
    ...result,
    tagline,
    intro: { html: introHtml, text: introText },
    subBlocks,
    splitTag,
    sectionCtas,
  }
  return result
}

/** Whether a group is shaped like a card list — used to decide if we
 *  route detected sub-blocks into it. */
function isCardShapedGroup(group: WebGroupDef): boolean {
  const c = canonical(group.key)
  return c === 'cards' || c === 'events' || c === 'tiles'
    || c === 'items' || c === 'features' || c === 'blocks'
    || c === 'list'
}

/** Fill a group's items from parsed sub-blocks — heading → heading slot,
 *  body → body slot, link → cta slot, image → image slot. Any item-schema
 *  field that can't be filled stays empty. */
function blocksToGroupItems(
  group: WebGroupDef,
  blocks: ParsedSubBlock[],
): Record<string, unknown>[] {
  return blocks.map(block => {
    const item: Record<string, unknown> = {}
    for (const field of group.item_schema) {
      if (field.kind !== 'slot') continue
      const c = canonical(field.key)
      if (c === 'heading') {
        item[field.key] = block.heading
      } else if (c === 'body') {
        if (field.type === 'richtext') item[field.key] = block.bodyHtml
        else item[field.key] = block.bodyText
      } else if (c === 'tagline') {
        // Some templates have a per-card tagline above the heading —
        // we don't carry one from the body parser, leave empty.
      } else if (c === 'cta' && field.type === 'cta' && block.cta) {
        item[field.key] = block.cta
      } else if (c === 'image' && field.type === 'image' && block.imageUrl) {
        item[field.key] = block.imageUrl
      }
    }
    return item
  })
}

/** Parse a freehand HTML body and pull straightforward chunks into
 *  template slots. Detects parallel `<h2/h3>+<p>` patterns and routes
 *  them into a card-shaped group (cards/items/features/blocks/events/
 *  tiles/list) when the template defines one. Single slots (heading,
 *  tagline, body) are filled from the pre-block intro content. */
export function mapHtmlBodyToTemplate(
  html: string,
  template: WebContentTemplate,
): { field_values: Record<string, unknown>; matched_slots: string[] } {
  if (typeof window === 'undefined' || !html) {
    return { field_values: {}, matched_slots: [] }
  }
  const parsed = parseBodyForBlocks(html)
  const out: Record<string, unknown> = {}
  const matched: string[] = []

  // Find the first card-shaped group in the template (if any). We only
  // route blocks into one group — multi-group templates are rare and
  // would need explicit brief routing anyway.
  let cardGroupKey: string | null = null
  for (const field of template.fields) {
    if (field.kind === 'group' && isCardShapedGroup(field)) {
      cardGroupKey = field.key
      break
    }
  }
  // CTA group target (buttons / ctas / actions / links) — separate
  // from the card-shaped group so a Hero with both `cards` and
  // `buttons` groups gets each filled from the right source.
  let ctaGroupKey: string | null = null
  for (const field of template.fields) {
    if (field.kind === 'group' && canonical(field.key) === 'cta') {
      ctaGroupKey = field.key
      break
    }
  }

  // Pop CTAs as we route them so each section CTA only fires once.
  const ctaQueue = [...parsed.sectionCtas]

  for (const field of template.fields) {
    if (field.kind === 'group') {
      if (field.key === cardGroupKey && parsed.subBlocks.length >= 2) {
        const items = blocksToGroupItems(field, parsed.subBlocks)
        out[field.key] = items
        matched.push(field.key)
      }
      if (field.key === ctaGroupKey && ctaQueue.length > 0) {
        const ctaSlot = field.item_schema.find(
          (f): f is WebSlotDef => f.kind === 'slot' && f.type === 'cta'
        )
        if (ctaSlot) {
          const take = ctaQueue.splice(0, ctaQueue.length)
          out[field.key] = take.map(c => ({ [ctaSlot.key]: c }))
          matched.push(field.key)
        }
      }
      continue
    }
    const key = canonical(field.key)

    if (key === 'heading' && parsed.sectionHeading) {
      out[field.key] = parsed.sectionHeading
      matched.push(field.key)
      continue
    }
    if (key === 'tagline' && parsed.tagline) {
      out[field.key] = parsed.tagline
      matched.push(field.key)
      continue
    }
    if (key === 'body') {
      if (field.type === 'richtext' && parsed.intro.html) {
        out[field.key] = parsed.intro.html
        matched.push(field.key)
        continue
      }
      if (field.type !== 'richtext' && parsed.intro.text) {
        out[field.key] = parsed.intro.text
        matched.push(field.key)
        continue
      }
    }
    // Top-level CTA slot (type='cta') — pull from the section-level
    // CTA queue. Most Brixies content sections model their main CTA
    // this way rather than as a group.
    if (field.type === 'cta' && ctaQueue.length > 0) {
      out[field.key] = ctaQueue.shift()
      matched.push(field.key)
      continue
    }
  }

  return { field_values: out, matched_slots: matched }
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
