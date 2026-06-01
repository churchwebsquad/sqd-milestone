/**
 * ContentDocument — the semantic IR for cowork briefs.
 *
 * Cowork (and any future content source) ships JSON with arbitrary
 * field naming conventions: `tagline` or `eyebrow`, `container_left`
 * or `description`, `staff_cards.items[]` or `team.members[]`. Earlier
 * versions of the binder tried to match those keys directly against
 * template slot keys with a growing alias table; that approach didn't
 * scale and lost structural intent.
 *
 * This module replaces that. The pipeline is now:
 *
 *   cowork brief ─► extractDocument ─► ContentDocument (semantic IR) ─►
 *     ┌─► fingerprintDocument ─► pairer scoring (template selection)
 *     └─► bindDocumentToTemplate ─► field_values (slot-by-slot fill)
 *
 * The IR represents content by *intent*, not by key. A `tagline` is
 * any short string that opens a section; a `description` is rich
 * body copy; an `items` block is N parallel children with a hint
 * about what kind (cards, team, faq, bullets, process, testimonial).
 *
 * Cowork's `template_id` and field naming are treated as
 * informational only — the extractor uses SHAPE first, then content,
 * then key names as a final tie-breaker.
 */
import { normalizeCtaValue, isButtonShapedSlot, type CtaValue } from './cta'
import type {
  WebContentTemplate, WebFieldDef, WebSlotDef, WebGroupDef,
} from '../types/database'

// ── IR types ──────────────────────────────────────────────────────────

/** What semantic role this block plays in the section. The binder
 *  matches blocks to template slots by intent — `kind: 'heading'`
 *  fills any heading slot regardless of slot key. */
export type ContentBlockKind =
  | 'tagline'         // short single-line label above the heading
  | 'heading'         // primary or sub-heading
  | 'subheading'      // secondary heading (level 3+)
  | 'description'     // rich-text body copy
  | 'image'           // image src
  | 'video'           // video URL / embed
  | 'cta'             // single CTA — { label, url }
  | 'items'           // group of parallel items (cards / bullets / team / faq)
  | 'name'            // person's name (team cards)
  | 'role'            // person's role / title (team cards)
  | 'email'
  | 'phone'
  | 'date'
  | 'quote'           // testimonial body
  | 'attribution'     // testimonial author
  | 'address'
  | 'question'
  | 'answer'

export type ItemsHint =
  | 'cards'                // generic detail cards
  | 'cards_with_bullets'   // each card has a nested bullet list
  | 'cards_with_cta'       // each card has a CTA
  | 'bullets'              // pure list of short strings
  | 'team'                 // staff/people cards (name + role + email)
  | 'process'              // step-numbered sequence
  | 'faq'                  // question + answer pairs
  | 'testimonial'          // quote + attribution
  | 'gallery'              // images
  | 'timeline'             // dated entries
  | 'links'                // multiple CTAs

export interface ContentBlock {
  kind: ContentBlockKind
  /** Stable identity across re-parses. Assigned by `assignNodeIds` from
   *  content similarity to a previous ContentDocument snapshot — so a
   *  reorder, heading rewrite, or small body edit preserves identity
   *  and any field_provenance.ir_path that points at this block
   *  continues to resolve. Format: `{kind}:{slug-from-content}-{tail}`.
   *  Optional because legacy callers haven't run the matcher yet.
   *  Added in v54. */
  node_id?: string
  text?:  string
  html?:  string
  url?:   string
  label?: string
  alt?:   string
  level?: 1 | 2 | 3 | 4 | 5 | 6
  items?: ContentItem[]
  hint?:  ItemsHint
  /** Original key on the cowork brief — informational, for debugging
   *  and the "see what I changed" panel. The binder never indexes on
   *  this field. */
  source_key?: string
}

export interface ContentItem {
  /** Stable identity across re-parses. See ContentBlock.node_id. */
  node_id?: string
  blocks: ContentBlock[]
  /** Optional hint refining what this item represents inside its
   *  parent items block (e.g. one card in a `team` items has hint
   *  `team_card`). Mostly used for traceability. */
  hint?: string
  source_index?: number
}

export interface ContentDocument {
  /** Top-level semantic blocks in section order. */
  blocks: ContentBlock[]
  /** Section position within the page, used by the pairer to detect
   *  hero vs middle-section vs footer-CTA. */
  position?: number
  total_sections?: number
  page_slug?: string
  page_title?: string
  /** Cowork's editorial label for the section ("hero_inner",
   *  "feature_tabbed"). Used as a tie-breaker only — never as
   *  authority. The shape always wins. */
  cowork_concept_hint?: string | null
  /** Cowork's template suggestion. Informational only — the pairer
   *  re-evaluates from scratch. */
  cowork_template_hint?: string | null
  /** Strategic intent string ("section_job" in cowork's brief). */
  section_job?: string | null
}

// ── Value shape detection (lifted from webUnmappedMapper) ─────────────

type ValueShape =
  | 'string_plain'
  | 'string_rich'
  | 'string_url'
  | 'array_strings'
  | 'array_objects'
  | 'array_mixed'
  | 'object_cta'
  | 'object_items'
  | 'object_record'
  | 'empty'

function detectShape(value: unknown): ValueShape {
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
    if (value.every(v => typeof v === 'string')) return 'array_strings'
    if (value.every(v => v && typeof v === 'object' && !Array.isArray(v))) return 'array_objects'
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

function unwrapItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const o = value as { items?: unknown }
    if (Array.isArray(o.items)) return o.items
  }
  return []
}

// ── Extraction ────────────────────────────────────────────────────────

/** Read a cowork section brief (or any field_values payload) and emit
 *  a ContentDocument. Field names are inspected as a tie-breaker only
 *  — value shape + content patterns drive classification. */
export function extractDocument(
  section: {
    field_values?: Record<string, unknown> | null
    concept_id?:   string | null
    template_id?:  string | null
    section_job?:  string | null
    sort_order?:   number
  },
  context: {
    position?: number
    total_sections?: number
    page_slug?: string
    page_title?: string
  } = {},
): ContentDocument {
  const fieldValues = (section.field_values ?? {}) as Record<string, unknown>
  const blocks: ContentBlock[] = []
  for (const [key, value] of Object.entries(fieldValues)) {
    if (key.startsWith('__')) continue   // skip __unmapped, __overflow_html, etc.
    blocks.push(...extractBlocks(key, value, /* depth */ 0))
  }
  // Sort blocks by canonical visual order so a tagline block consistently
  // precedes the heading, heading precedes description, etc. The binder
  // walks template slots in their own order so this isn't strictly
  // required, but it makes the IR easier to reason about + debug.
  blocks.sort((a, b) => CANONICAL_ORDER[a.kind] - CANONICAL_ORDER[b.kind])

  return {
    blocks,
    position:               context.position,
    total_sections:         context.total_sections,
    page_slug:              context.page_slug,
    page_title:             context.page_title,
    cowork_concept_hint:    section.concept_id ?? null,
    cowork_template_hint:   section.template_id ?? null,
    section_job:            section.section_job ?? null,
  }
}

/** Canonical visual ordering of block kinds — taglines + headings
 *  open a section, descriptions follow, media + CTAs after, item
 *  groups last. */
const CANONICAL_ORDER: Record<ContentBlockKind, number> = {
  tagline: 0, heading: 1, subheading: 2, description: 3,
  image: 4, video: 5, cta: 6, items: 7,
  name: 8, role: 9, email: 10, phone: 11, date: 12,
  quote: 13, attribution: 14, address: 15,
  question: 16, answer: 17,
}

function extractBlocks(key: string, value: unknown, depth: number): ContentBlock[] {
  const shape = detectShape(value)
  if (shape === 'empty') return []

  // ── Group / items shapes ─────────────────────────────────────────
  if (shape === 'array_objects' || shape === 'object_items' || shape === 'array_strings') {
    const items = unwrapItems(value)
    if (items.length === 0) return []

    // Special-case: a "buttons" wrapper with one or more items is
    // really N CTAs at this level — flatten and emit as `cta` blocks
    // (or a single `items` block with hint='links' when 2+).
    if (isButtonsContainer(key, items)) {
      const ctas = items
        .map(it => extractCtaFromItem(it))
        .filter((c): c is { label: string; url: string } => c !== null)
      if (ctas.length === 0) return []
      if (ctas.length === 1) {
        return [{ kind: 'cta', label: ctas[0].label, url: ctas[0].url, source_key: key }]
      }
      return [{
        kind: 'items',
        hint: 'links',
        items: ctas.map((c, i) => ({
          blocks: [{ kind: 'cta', label: c.label, url: c.url }],
          source_index: i,
        })),
        source_key: key,
      }]
    }

    // Detect items hint from item content.
    const hint = detectItemsHint(items)
    const itemBlocks = items.map((item, i) => extractItem(item, i, depth + 1))
    return [{
      kind: 'items',
      hint,
      items: itemBlocks,
      source_key: key,
    }]
  }

  // ── CTA shape ────────────────────────────────────────────────────
  if (shape === 'object_cta') {
    const cta = normalizeCtaValue(value)
    if (!cta.label && !cta.url) return []
    return [{ kind: 'cta', label: cta.label, url: cta.url, source_key: key }]
  }

  // ── Scalar shapes ────────────────────────────────────────────────
  const role = classifyScalarRole(key, value, shape, depth)
  switch (role) {
    case 'tagline':
      return [{ kind: 'tagline', text: String(value), source_key: key }]
    case 'heading':
      return [{ kind: 'heading', text: String(value), level: depth === 0 ? 2 : 3, source_key: key }]
    case 'subheading':
      return [{ kind: 'subheading', text: String(value), level: 3, source_key: key }]
    case 'description':
      return [{ kind: 'description', html: String(value), source_key: key }]
    case 'image':
      return [{ kind: 'image', url: String(value), source_key: key }]
    case 'video':
      return [{ kind: 'video', url: String(value), source_key: key }]
    case 'cta':
      return [{ kind: 'cta', label: String(value), url: '', source_key: key }]
    case 'name':
      return [{ kind: 'name', text: String(value), source_key: key }]
    case 'role':
      return [{ kind: 'role', text: String(value), source_key: key }]
    case 'email':
      return [{ kind: 'email', text: String(value), source_key: key }]
    case 'phone':
      return [{ kind: 'phone', text: String(value), source_key: key }]
    case 'date':
      return [{ kind: 'date', text: String(value), source_key: key }]
    case 'quote':
      return [{ kind: 'quote', text: String(value), source_key: key }]
    case 'attribution':
      return [{ kind: 'attribution', text: String(value), source_key: key }]
    case 'address':
      return [{ kind: 'address', text: String(value), source_key: key }]
    case 'question':
      return [{ kind: 'question', text: String(value), source_key: key }]
    case 'answer':
      return [{ kind: 'answer', html: String(value), source_key: key }]
    default:
      // Unknown scalar — bin by length: short → tagline, medium →
      // heading, long → description. Better to surface as something
      // editable than drop.
      if (typeof value === 'string') {
        const len = value.trim().length
        if (len < 50)  return [{ kind: 'tagline',     text: value, source_key: key }]
        if (len < 160) return [{ kind: 'heading',     text: value, level: depth === 0 ? 2 : 3, source_key: key }]
        return            [{ kind: 'description', html: value, source_key: key }]
      }
      return []
  }
}

function extractItem(item: unknown, idx: number, depth: number): ContentItem {
  if (typeof item === 'string') {
    return {
      blocks: [{ kind: 'description', html: item }],
      source_index: idx,
    }
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { blocks: [], source_index: idx }
  }
  const itemObj = item as Record<string, unknown>
  // Context detection — when the item carries a `name` field (typical
  // staff card shape), `title` means "job title / role" not heading.
  // Without this override, classifyScalarRole would pick 'heading'
  // for `title` and the team-card name+role pair would render with
  // the role acting as the H3 (wrong).
  const isTeamCard = typeof itemObj.name === 'string' && itemObj.name.trim() !== ''
                   && (typeof itemObj.title === 'string'
                       || typeof itemObj.role === 'string'
                       || typeof itemObj.email === 'string')

  const innerBlocks: ContentBlock[] = []
  for (const [k, v] of Object.entries(itemObj)) {
    if (k.startsWith('__')) continue
    if (isTeamCard && (k === 'title' || k === 'role' || k === 'position')) {
      if (typeof v === 'string' && v.trim()) {
        innerBlocks.push({ kind: 'role', text: v, source_key: k })
      }
      continue
    }
    if (isTeamCard && k === 'name') {
      if (typeof v === 'string' && v.trim()) {
        innerBlocks.push({ kind: 'name', text: v, source_key: k })
      }
      continue
    }
    innerBlocks.push(...extractBlocks(k, v, depth))
  }
  innerBlocks.sort((a, b) => CANONICAL_ORDER[a.kind] - CANONICAL_ORDER[b.kind])
  return {
    blocks: innerBlocks,
    source_index: idx,
  }
}

// ── Role classification ───────────────────────────────────────────────

type ScalarRole =
  | 'tagline' | 'heading' | 'subheading' | 'description'
  | 'image' | 'video' | 'cta'
  | 'name' | 'role' | 'email' | 'phone' | 'date'
  | 'quote' | 'attribution' | 'address'
  | 'question' | 'answer'
  | 'unknown'

function classifyScalarRole(
  key: string,
  value: unknown,
  shape: ValueShape,
  _depth: number,
): ScalarRole {
  const k = canon(key)

  // URL-shaped strings into image vs CTA decision.
  if (shape === 'string_url') {
    if (/^(image|photo|picture|thumbnail|avatar)/.test(k)) return 'image'
    if (/(video|embed|youtube|vimeo)/.test(k)) return 'video'
    // Email / tel-shaped → respective.
    const s = String(value)
    if (s.startsWith('mailto:')) return 'email'
    if (s.startsWith('tel:'))    return 'phone'
    // Otherwise CTA url with no label.
    if (/(cta|button|link|url|href|action)/.test(k)) return 'cta'
    // Default URL → image when no other signal.
    return 'image'
  }

  // Key-based scalar classification.
  if (/(tagline|eyebrow|kicker|pretitle|preheading)/.test(k)) return 'tagline'
  if (/(subheading|subtitle)/.test(k))                         return 'subheading'
  if (/(^|_)(heading|title|h1|h2)($|_)/.test(k) || k === 'heading' || k === 'title') return 'heading'
  if (/(description|body|content|paragraph|info|detail|summary|caption|excerpt)/.test(k)) return 'description'
  if (/^(image|photo|picture|thumbnail|avatar)/.test(k)) return 'image'
  if (/(video|embed)/.test(k))                            return 'video'
  if (/^(cta|button|link|action)/.test(k))                return 'cta'
  if (k === 'name' || k === 'fullname' || k === 'fullName' || /^(person|member)_?name/.test(k)) return 'name'
  if (k === 'role' || k === 'position' || k === 'jobtitle' || k === 'titlerole') return 'role'
  if (k === 'email' || k === 'contactemail') return 'email'
  if (k === 'phone' || k === 'tel')           return 'phone'
  if (k === 'date' || /(_at|_on|date|when)$/.test(k)) return 'date'
  if (k === 'quote' || k === 'testimonial')   return 'quote'
  if (k === 'attribution' || k === 'author' || k === 'speaker') return 'attribution'
  if (k === 'address' || k === 'location')    return 'address'
  if (k === 'question')                       return 'question'
  if (k === 'answer')                         return 'answer'

  // Length-based fallback for ambiguous string scalars.
  if (typeof value === 'string') {
    const t = value.trim()
    if (t.length < 50)  return 'tagline'
    if (t.length < 160) return 'heading'
    return 'description'
  }
  return 'unknown'
}

// ── Items hint detection ──────────────────────────────────────────────

function detectItemsHint(items: unknown[]): ItemsHint {
  if (items.length === 0) return 'cards'
  // All-string items → bullets.
  if (items.every(it => typeof it === 'string')) return 'bullets'

  // Item-shape pattern matching.
  const keys = items
    .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object' && !Array.isArray(it))
    .map(it => new Set(Object.keys(it).map(canon)))
  if (keys.length === 0) return 'cards'

  const allHave = (...needles: string[]): boolean =>
    keys.every(s => needles.some(n => s.has(canon(n))))
  const someHave = (...needles: string[]): boolean =>
    keys.some(s => needles.some(n => s.has(canon(n))))

  // Single-field text-bearing items → bullets (cowork's
  // `feature_element.items: [{text: "…"}, …]` pattern).
  const allSingleText = keys.every(s =>
    s.size === 1 && (s.has('text') || s.has('label') || s.has('content') || s.has('item')))
  if (allSingleText) return 'bullets'

  if (allHave('question') && allHave('answer')) return 'faq'
  if (allHave('name') && (someHave('title') || someHave('role') || someHave('email'))) return 'team'
  if (allHave('quote') || (allHave('text') && someHave('author'))) return 'testimonial'
  if (someHave('step') || someHave('step_number') || someHave('order') || someHave('sequence')) return 'process'
  if (allHave('date') && (someHave('title') || someHave('name'))) return 'timeline'

  // Cards with nested bullets (feature_element / list / items inside).
  const hasNestedBullets = items.some(it => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return false
    for (const [k, v] of Object.entries(it as Record<string, unknown>)) {
      if (/feature_element|list|bullets|highlights/i.test(k)) {
        if (Array.isArray(v) || (v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items))) return true
      }
    }
    return false
  })
  if (hasNestedBullets) return 'cards_with_bullets'

  const hasPerItemCta = items.some(it => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return false
    for (const [k, v] of Object.entries(it as Record<string, unknown>)) {
      if (/cta|button|link|action/i.test(k) && !isEmptyValue(v)) return true
    }
    return false
  })
  if (hasPerItemCta) return 'cards_with_cta'

  return 'cards'
}

function isButtonsContainer(key: string, items: unknown[]): boolean {
  if (!/^(buttons?|ctas?|actions?|links?)$/i.test(key)) return false
  // Verify items look CTA-shaped.
  return items.every(it => {
    if (typeof it === 'string') return true
    if (!it || typeof it !== 'object' || Array.isArray(it)) return false
    const o = it as Record<string, unknown>
    return typeof o.label === 'string' || typeof o.text === 'string'
        || typeof o.url === 'string'   || typeof o.href === 'string'
        || typeof o.contact === 'string'
  })
}

function extractCtaFromItem(item: unknown): { label: string; url: string } | null {
  if (typeof item === 'string') {
    const cta = normalizeCtaValue(item)
    return cta.label || cta.url ? cta : null
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const cta = normalizeCtaValue(item)
  return cta.label || cta.url ? { label: cta.label, url: cta.url } : null
}

// ── Fingerprint bridge to the pairer ──────────────────────────────────

/** Pairer-friendly fingerprint built directly from a ContentDocument.
 *  The pairer expects a `FieldShape`-shaped object (see
 *  webBrixiesPairer.ts) — this builds the same vector from the IR. */
export interface DocumentFingerprint {
  has_tagline:      boolean
  has_heading:      boolean
  has_description:  boolean
  has_image:        boolean
  has_video:        boolean
  has_name:         boolean
  has_title:        boolean
  has_email:        boolean
  has_role:         boolean
  has_quote:        boolean
  has_date:         boolean
  has_speaker:      boolean
  has_step_number:  boolean
  has_question:     boolean
  has_answer:       boolean
  has_address:      boolean
  cta_count:        number
  primary_group:    {
    key: string
    count: number
    hint: ItemsHint | undefined
    bullet_count: number
    per_item: Omit<DocumentFingerprint, 'primary_group' | 'total_groups'>
  } | null
  total_groups:     number
}

function emptyFingerprint(): Omit<DocumentFingerprint, 'primary_group' | 'total_groups'> {
  return {
    has_tagline: false, has_heading: false, has_description: false,
    has_image: false, has_video: false, has_name: false, has_title: false,
    has_email: false, has_role: false, has_quote: false, has_date: false,
    has_speaker: false, has_step_number: false, has_question: false,
    has_answer: false, has_address: false, cta_count: 0,
  }
}

export function fingerprintDocument(doc: ContentDocument): DocumentFingerprint {
  const base = fingerprintBlocks(doc.blocks)
  // Promote the largest items block to "primary_group" so the pairer
  // can compute group-shape match scores.
  let primary: DocumentFingerprint['primary_group'] = null
  let primarySize = 0
  let totalGroups = 0
  for (const b of doc.blocks) {
    if (b.kind !== 'items' || !b.items) continue
    totalGroups++
    const size = b.items.length
    if (size <= primarySize) continue
    const itemFingerprints = b.items.map(it => fingerprintBlocks(it.blocks))
    const merged = mergeFingerprints(itemFingerprints)
    const bulletCount = b.items.reduce((max, it) => {
      const inner = it.blocks.find(ib => ib.kind === 'items' && ib.hint === 'bullets')
      const n = inner?.items?.length ?? 0
      return n > max ? n : max
    }, 0)
    primary = {
      key: b.source_key ?? 'items',
      count: size,
      hint: b.hint,
      bullet_count: bulletCount,
      per_item: merged,
    }
    primarySize = size
  }
  return { ...base, primary_group: primary, total_groups: totalGroups }
}

function fingerprintBlocks(blocks: ContentBlock[]): Omit<DocumentFingerprint, 'primary_group' | 'total_groups'> {
  const out = emptyFingerprint()
  for (const b of blocks) {
    switch (b.kind) {
      case 'tagline':     out.has_tagline = true; break
      case 'heading':
      case 'subheading':  out.has_heading = true; break
      case 'description':
      case 'answer':      out.has_description = true; break
      case 'image':       out.has_image = true; break
      case 'video':       out.has_video = true; break
      case 'cta':         out.cta_count++; break
      case 'name':        out.has_name = true; break
      case 'role':        out.has_role = true; out.has_title = true; break
      case 'email':       out.has_email = true; break
      case 'date':        out.has_date = true; break
      case 'quote':       out.has_quote = true; break
      case 'attribution': out.has_speaker = true; break
      case 'address':     out.has_address = true; break
      case 'question':    out.has_question = true; break
      case 'items':
        if (b.hint === 'links' && b.items) out.cta_count += b.items.length
        break
    }
  }
  return out
}

function mergeFingerprints(
  fps: Array<Omit<DocumentFingerprint, 'primary_group' | 'total_groups'>>,
): Omit<DocumentFingerprint, 'primary_group' | 'total_groups'> {
  const out = emptyFingerprint()
  for (const fp of fps) {
    for (const k of Object.keys(out) as Array<keyof typeof out>) {
      const v = fp[k]
      if (typeof v === 'boolean' && v) (out as Record<string, unknown>)[k] = true
    }
    out.cta_count = Math.max(out.cta_count, fp.cta_count)
  }
  return out
}

// ── Schema-driven binder ──────────────────────────────────────────────

/** Walk a template's field schema and fill each slot/group from the
 *  best-matching block in `doc`. The binder doesn't care what cowork
 *  called the field — it matches by intent. Blocks already consumed
 *  by a slot don't get reused.
 *
 *  Palette-referenced groups (item_template_ref) resolve their
 *  effective item_schema from the referenced Card template so item
 *  field naming aligns to the palette's slots.
 *
 *  Optional `outProvenance` records which IR block produced each slot's
 *  value — keyed by the template slot key. Used by the field provenance
 *  layer to populate `ir_path` / `ir_kind` / `ir_text_snippet` so the
 *  Text-view bind inspector can show "tagline · auto · from heading
 *  block 'Welcome Home'". Pass `undefined` to skip tracing (zero-cost). */
export function bindDocumentToTemplate(
  doc:              ContentDocument,
  template:         WebContentTemplate,
  paletteTemplates: Record<string, WebContentTemplate> = {},
  outProvenance?:   BindProvenanceMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!Array.isArray(template.fields)) return out

  const claimed = new Set<ContentBlock>()
  const remainingBlocks = () => doc.blocks.filter(b => !claimed.has(b))

  for (const field of template.fields) {
    if (field.kind === 'slot') {
      const block = pickBlockForSlot(field, remainingBlocks())
      if (block) {
        claimed.add(block)
        const value = blockToSlotValue(block, field)
        if (value !== undefined) {
          out[field.key] = value
          if (outProvenance) outProvenance[field.key] = traceFromBlock(block)
        }
      }
    } else if (field.kind === 'group') {
      const block = pickItemsBlockForGroup(field, remainingBlocks(), paletteTemplates)
      if (block) {
        claimed.add(block)
        const itemSchema = resolveEffectiveItemSchema(field, paletteTemplates)
        // Bind each IR item, then drop items where EVERY field came back
        // empty. Empty items leak in two cases: (a) the IR had fewer
        // content blocks than the source's `default_count` for repeating
        // items so the binder produces blank rows, (b) a synthesized
        // buttons-group gathers CTAs whose label + url are both empty.
        // Either way, the renderer shouldn't surface "phantom" cards or
        // buttons; the bind inspector still flags the group as unbound /
        // partial so the signal isn't lost.
        const items = (block.items ?? [])
          .map(item => bindItemToSchema(item, itemSchema, paletteTemplates))
          .filter(itemHasMeaningfulValue)
        out[field.key] = items
        if (outProvenance) outProvenance[field.key] = traceFromGroupBlock(block)
      }
    }
  }
  return out
}

/** Per-slot record of which IR block populated a value. Built by
 *  `bindDocumentToTemplate` when an `outProvenance` map is supplied, and
 *  consumed by `deriveProvenanceFromBind` (in webFieldProvenance.ts) to
 *  emit `auto({ ir_path, ir_kind, ir_text_snippet })` entries. */
export interface BindTrace {
  /** Node id of the source IR block. Resolves via `resolveIrPath`. */
  ir_node_id?: string
  /** Source block's kind — for the inspector's "from: heading" badge. */
  ir_kind?: ContentBlockKind
  /** First ~80 chars of source text. Display-only — the canonical source
   *  is the IR snapshot resolved via `ir_path`. */
  ir_text_snippet?: string
}

export type BindProvenanceMap = Record<string, BindTrace>

/** Build a `blocks{node_id=...}` IR path string from a node id. Mirrors
 *  the format `resolveIrPath` understands. */
export function buildBlockIrPath(nodeId: string): string {
  return `blocks{node_id=${nodeId}}`
}

function traceFromBlock(block: ContentBlock): BindTrace {
  const t: BindTrace = { ir_kind: block.kind }
  if (block.node_id) t.ir_node_id = block.node_id
  const snippet = pickBlockSnippet(block)
  if (snippet) t.ir_text_snippet = snippet
  return t
}

/** Items-block trace — synthesized buttons containers have no node_id but
 *  we still surface a usable kind + snippet so the inspector reads as
 *  "from: items · 'Sign up · Learn more · …'". */
function traceFromGroupBlock(block: ContentBlock): BindTrace {
  const t: BindTrace = { ir_kind: block.kind }
  if (block.node_id) t.ir_node_id = block.node_id
  const snippet = pickGroupSnippet(block)
  if (snippet) t.ir_text_snippet = snippet
  return t
}

function pickBlockSnippet(block: ContentBlock): string {
  const raw = block.text ?? block.label ?? block.html ?? block.url ?? ''
  return truncateSnippet(raw)
}

function pickGroupSnippet(block: ContentBlock): string {
  const items = block.items ?? []
  if (items.length === 0) return ''
  const labels: string[] = []
  for (const it of items.slice(0, 3)) {
    const first = it.blocks?.[0]
    if (!first) continue
    const txt = (first.label ?? first.text ?? '').trim()
    if (txt) labels.push(txt)
  }
  const more = items.length > labels.length ? ` · +${items.length - labels.length} more` : ''
  return truncateSnippet(labels.join(' · ') + more)
}

function truncateSnippet(raw: string): string {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > 80 ? t.slice(0, 77).trimEnd() + '…' : t
}

/** True if at least one of the bound item's field values would render
 *  something. Used to drop phantom items from a group's items array
 *  before they reach the renderer. Recurses into nested objects/arrays
 *  so a card with an empty CTA + empty heading + empty description
 *  drops, but a card with just a heading survives. */
function itemHasMeaningfulValue(item: Record<string, unknown>): boolean {
  for (const v of Object.values(item)) {
    if (isMeaningfulValue(v)) return true
  }
  return false
}

function isMeaningfulValue(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.some(isMeaningfulValue)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('label' in o || 'url' in o) {
      const label = typeof o.label === 'string' ? o.label.trim() : ''
      const url   = typeof o.url   === 'string' ? o.url.trim()   : ''
      return Boolean(label || url)
    }
    if ('items' in o && Array.isArray((o as { items: unknown[] }).items)) {
      return (o as { items: unknown[] }).items.some(isMeaningfulValue)
    }
    return Object.values(o).some(isMeaningfulValue)
  }
  return Boolean(v)
}

function pickBlockForSlot(slot: WebSlotDef, blocks: ContentBlock[]): ContentBlock | null {
  const intent = inferSlotIntent(slot)
  // First pass: exact intent match.
  for (const b of blocks) if (b.kind === intent) return b
  // Second pass: compatible substitutions.
  for (const b of blocks) {
    if (intent === 'heading'     && b.kind === 'subheading')   return b
    if (intent === 'subheading'  && b.kind === 'heading')      return b
    if (intent === 'description' && b.kind === 'answer')       return b
    if (intent === 'cta'         && b.kind === 'cta')          return b
    if (intent === 'name'        && b.kind === 'heading')      return b
    if (intent === 'role'        && b.kind === 'description')  return b
    if (intent === 'role'        && b.kind === 'subheading')   return b
    if (intent === 'role'        && b.kind === 'heading')      return b
    if (intent === 'email'       && b.kind === 'cta')          return b
  }
  // Third pass: type-only fallback for unmatched intents. Heading
  // slots accept any text block; richtext slots accept any rich
  // content.
  if (slot.type === 'text') {
    for (const b of blocks) {
      if (b.kind === 'tagline' || b.kind === 'heading' || b.kind === 'subheading'
          || b.kind === 'name'  || b.kind === 'role') return b
    }
  }
  if (slot.type === 'richtext') {
    for (const b of blocks) {
      if (b.kind === 'description' || b.kind === 'answer'
          || b.kind === 'quote') return b
    }
  }
  return null
}

function pickItemsBlockForGroup(
  group:            WebGroupDef,
  blocks:           ContentBlock[],
  paletteTemplates: Record<string, WebContentTemplate>,
): ContentBlock | null {
  // Skip palette-ref groups that are CTAs ("buttons") — they get
  // filled by collecting `cta`-kind blocks via separate logic below.
  const itemSchema = resolveEffectiveItemSchema(group, paletteTemplates)
  const isButtonsGroup = /^(buttons?|ctas?|actions?|links?)$/i.test(group.key)
                       || itemSchema.length === 1 && itemSchema[0].kind === 'slot'
                            && (itemSchema[0].type === 'cta' || isButtonShapedSlot(itemSchema[0] as WebSlotDef))

  // Buttons group → gather every unclaimed cta + items-with-hint=links.
  if (isButtonsGroup) {
    const ctas: ContentBlock[] = []
    for (const b of blocks) {
      if (b.kind === 'cta') ctas.push(b)
      else if (b.kind === 'items' && b.hint === 'links' && b.items) {
        for (const it of b.items) {
          const cb = it.blocks.find(ib => ib.kind === 'cta')
          if (cb) ctas.push(cb)
        }
      }
    }
    if (ctas.length === 0) return null
    // Synthesize a single items block representing the gathered CTAs.
    return {
      kind: 'items',
      hint: 'links',
      items: ctas.map(c => ({ blocks: [c] })),
      source_key: group.key,
    }
  }

  // Normal items group → pick the first matching `items` block by
  // hint alignment.
  const groupIntent = inferGroupIntent(group, itemSchema)
  for (const b of blocks) {
    if (b.kind !== 'items') continue
    if (groupIntent === 'any' || hintMatches(b.hint, groupIntent)) return b
  }
  // Fallback — any unclaimed items block.
  for (const b of blocks) if (b.kind === 'items') return b

  // Shallow-content promotion (single_instance_hint): some templates
  // wrap a leaf slot inside one or more `single_instance_hint: true`
  // groups so the source HTML can render the slot in its own visual
  // region. Content Section 80 is the canonical case — its `card` schema
  // wraps a description slot inside `counter` (single_instance_hint).
  // Cowork ships card content flat (no `counter` items block), so the
  // schema's leaf slot never gets populated. Synthesize a single-item
  // items block from the parent's content blocks when:
  //   • the group has single_instance_hint=true (one-and-only-one item)
  //   • the schema below it has at least one leaf slot whose intent
  //     matches a still-unclaimed block in `blocks`
  // The synthesized item carries the parent's content blocks; the
  // recursive bind into the item schema then assigns them to leaves.
  if (group.single_instance_hint && blocks.some(b => groupHasMatchingLeafForBlock(itemSchema, b, paletteTemplates))) {
    return {
      kind: 'items',
      items: [{ blocks: [...blocks] }],
      source_key: group.key,
    }
  }
  return null
}

/** True if `itemSchema` contains a leaf slot whose `pickBlockForSlot`
 *  would accept this block. Walks nested groups so a slot buried under
 *  `single_instance_hint` wrappers still counts. Used by the shallow-
 *  content promotion path to decide whether synthesizing a single item
 *  would actually let the binder place the block. */
function groupHasMatchingLeafForBlock(
  itemSchema:       ReadonlyArray<WebFieldDef>,
  block:            ContentBlock,
  paletteTemplates: Record<string, WebContentTemplate>,
): boolean {
  for (const f of itemSchema) {
    if (f.kind === 'slot') {
      if (pickBlockForSlot(f as WebSlotDef, [block])) return true
    } else if (f.kind === 'group') {
      const sub = resolveEffectiveItemSchema(f as WebGroupDef, paletteTemplates)
      if (groupHasMatchingLeafForBlock(sub, block, paletteTemplates)) return true
    }
  }
  return false
}

function bindItemToSchema(
  item:             ContentItem,
  itemSchema:       WebFieldDef[],
  paletteTemplates: Record<string, WebContentTemplate>,
): Record<string, unknown> {
  // Pre-pass: if the item has a bullet-list block and the schema
  // doesn't have a bullet group, fold the bullets into the
  // description block before binding. This preserves content that
  // would otherwise drop (e.g. cowork's `feature_element.items` when
  // the target card schema has no per-card list group).
  const adjustedBlocks = foldBulletsIntoDescription(item.blocks, itemSchema)
  // Recursive bind — items have their own blocks; treat each item as
  // a mini-template.
  const subDoc: ContentDocument = {
    blocks: adjustedBlocks,
  }
  const subTemplate: WebContentTemplate = {
    id:         '__item',
    layer_name: '',
    family:     '',
    kind:       'component',
    fields:     itemSchema,
    source_html: '',
    preview_image_url: null,
  } as WebContentTemplate
  return bindDocumentToTemplate(subDoc, subTemplate, paletteTemplates)
}

/** When the item has a bullet-list block but the target item_schema
 *  has no group that accepts bullets, append the bullet list as HTML
 *  into the description block instead. Preserves the strategist's
 *  content rather than dropping it silently. */
function foldBulletsIntoDescription(
  blocks:     ContentBlock[],
  itemSchema: WebFieldDef[],
): ContentBlock[] {
  const bulletBlock = blocks.find(b => b.kind === 'items' && b.hint === 'bullets')
  if (!bulletBlock || !bulletBlock.items || bulletBlock.items.length === 0) return blocks

  // Does the schema have a group that would accept bullets? Strict —
  // only groups whose name explicitly signals bullets. A "single text
  // slot" heuristic would otherwise catch the buttons-group pattern
  // (Feature 43's `buttons` has a single `contact` text slot scoped
  // as a button) and mis-route bullets there.
  const hasBulletGroup = itemSchema.some(f => {
    if (f.kind !== 'group') return false
    const key = canon(f.key) + canon(f.layer_name ?? '')
    if (/^(buttons?|ctas?|actions?|links?)/.test(canon(f.key))) return false
    return /list|bullets|highlights|features?element|points/.test(key)
  })
  if (hasBulletGroup) return blocks   // bullets will bind to that group

  // No bullet group available — fold into description.
  const bulletStrings = bulletBlock.items
    .map(it => {
      const desc = it.blocks.find(b => b.kind === 'description' || b.kind === 'tagline' || b.kind === 'heading')
      return desc?.text ?? desc?.html ?? ''
    })
    .filter(s => s.trim())
  if (bulletStrings.length === 0) return blocks
  const bulletHtml = `<ul>${bulletStrings.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`

  const out: ContentBlock[] = []
  let descAppended = false
  for (const b of blocks) {
    if (b === bulletBlock) continue   // drop the bullet block (folded)
    if (b.kind === 'description' && !descAppended) {
      out.push({
        ...b,
        html: (b.html ?? b.text ?? '') + bulletHtml,
      })
      descAppended = true
    } else {
      out.push(b)
    }
  }
  // If no description block existed, add one with just the bullets.
  if (!descAppended) {
    out.push({ kind: 'description', html: bulletHtml })
  }
  return out
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

/** Translate a single ContentBlock into the value shape the target
 *  slot expects. Text slots get strings, richtext gets HTML, image
 *  gets the URL, CTA gets `{label, url}`. */
function blockToSlotValue(block: ContentBlock, slot: WebSlotDef): unknown {
  // Button-shaped text slot gets the CTA payload.
  if (slot.type === 'cta' || isButtonShapedSlot(slot)) {
    if (block.kind === 'cta') {
      return { label: block.label ?? '', url: block.url ?? '' } as CtaValue
    }
    // Synthesize from a stray scalar block.
    if (block.text) return { label: block.text, url: block.url ?? '' } as CtaValue
    if (block.url)  return { label: '',         url: block.url } as CtaValue
  }

  if (slot.type === 'image') {
    return block.url ?? block.text ?? ''
  }
  if (slot.type === 'richtext') {
    return block.html ?? block.text ?? ''
  }
  // text / url / email / phone / datetime
  if (block.text) return block.text
  if (block.html) return stripHtml(block.html)
  if (block.label) return block.label
  if (block.url) return block.url
  return ''
}

function inferSlotIntent(slot: WebSlotDef): ContentBlockKind {
  const k = canon(slot.key) + ' ' + canon(slot.layer_name ?? '') + ' ' + canon(slot.label ?? '')
  if (/tagline|eyebrow|kicker|pretitle/.test(k))     return 'tagline'
  if (/subheading|subtitle/.test(k))                  return 'subheading'
  if (/heading|title|h1|h2/.test(k))                  return 'heading'
  if (/description|body|content|paragraph|info|detail|summary|caption|answer/.test(k)) return 'description'
  if (slot.type === 'image' || /image|photo|picture|thumbnail|avatar/.test(k)) return 'image'
  if (/video|embed/.test(k))                          return 'video'
  if (slot.type === 'cta' || isButtonShapedSlot(slot)) return 'cta'
  if (/^name$|^fullname$/.test(k))                    return 'name'
  if (/role|position|jobtitle/.test(k))               return 'role'
  if (/email/.test(k))                                return 'email'
  if (/^phone$|^tel$/.test(k))                        return 'phone'
  if (/date|published/.test(k))                       return 'date'
  if (/quote|testimonial/.test(k))                    return 'quote'
  if (/speaker|preacher|teacher/.test(k))             return 'attribution'
  if (/address|location/.test(k))                     return 'address'
  if (/question/.test(k))                             return 'question'
  return 'description'  // catch-all
}

function inferGroupIntent(group: WebGroupDef, itemSchema: WebFieldDef[]): ItemsHint | 'any' {
  const k = canon(group.key) + ' ' + canon(group.layer_name ?? '')
  if (/team|staff|people|member/.test(k))             return 'team'
  if (/faq|accordion|question/.test(k))                return 'faq'
  if (/process|step|sequence/.test(k))                 return 'process'
  if (/testimonial|quote/.test(k))                     return 'testimonial'
  if (/gallery|photos?|images?/.test(k))               return 'gallery'
  if (/timeline|history/.test(k))                      return 'timeline'
  if (/feature_?element|list|bullets|highlights|points/.test(k)) return 'bullets'

  // Inspect item_schema for distinctive shapes.
  const itemKeys = itemSchema.map(f => canon(f.key)).join(' ')
  if (/\bname\b/.test(itemKeys) && /\btitle\b|\brole\b|\bemail\b/.test(itemKeys)) return 'team'
  if (/\bquestion\b/.test(itemKeys) && /\banswer\b/.test(itemKeys))               return 'faq'

  // Single text slot → bullet group.
  if (itemSchema.length === 1 && itemSchema[0].kind === 'slot'
      && itemSchema[0].type === 'text') return 'bullets'

  return 'any'  // accepts any items block
}

function hintMatches(blockHint: ItemsHint | undefined, intent: ItemsHint | 'any'): boolean {
  if (intent === 'any') return true
  if (blockHint === intent) return true
  // Cards-family hints are interchangeable for generic feature groups.
  const cardsFamily = new Set<ItemsHint | undefined>(['cards', 'cards_with_bullets', 'cards_with_cta'])
  if (cardsFamily.has(blockHint) && cardsFamily.has(intent)) return true
  return false
}

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

// ── Helpers ──────────────────────────────────────────────────────────

function canon(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '')
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('items' in o && Array.isArray(o.items)) return (o.items as unknown[]).length === 0
    if ('label' in o || 'url' in o) return !o.label && !o.url
    return Object.keys(o).length === 0
  }
  return false
}

function stripHtml(s: string): string {
  return s.replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\s+/g, ' ').trim()
}

// ── Node-id assignment (matcher) ──────────────────────────────────────
//
// Carries `node_id` forward across re-parses by matching new blocks /
// items to old ones by content similarity. The Text view edits markdown,
// the parser produces a fresh IR, this matcher walks the fresh + previous
// IRs and assigns stable IDs:
//
//   • Same kind + high content overlap → inherit the previous id
//   • Same kind + low overlap → fresh id; any field_provenance.ir_path
//     pointing at the old id flips to `unbound` in the next bind pass
//   • Different kinds → never matched
//
// Greedy in score-descending order; each previous id can be inherited at
// most once. Stops silent loss: when a chunk of prose is rewritten enough
// to lose its identity, the binding it fed becomes visibly unbound rather
// than carrying stale content.
//
// `previous` may be null on first parse — every block then gets a fresh id.

const MATCH_THRESHOLD = 0.5

/** Walk fresh IR; assign `node_id` to every block + nested item. Mutates
 *  in place (cheaper than deep-clone; callers pass a just-extracted IR). */
export function assignNodeIds(
  fresh: ContentDocument,
  previous: ContentDocument | null | undefined,
): ContentDocument {
  fresh.blocks = matchBlocks(fresh.blocks, previous?.blocks ?? [])
  return fresh
}

function matchBlocks(fresh: ContentBlock[], previous: ContentBlock[]): ContentBlock[] {
  type Pair = { newIdx: number; prevIdx: number; score: number }
  const pairs: Pair[] = []
  // Group previous by kind for fast same-kind lookup
  const prevByKind = new Map<string, number[]>()
  previous.forEach((b, i) => {
    const arr = prevByKind.get(b.kind) ?? []
    arr.push(i)
    prevByKind.set(b.kind, arr)
  })
  fresh.forEach((newBlock, newIdx) => {
    const candidates = prevByKind.get(newBlock.kind) ?? []
    for (const prevIdx of candidates) {
      const score = scoreBlocks(newBlock, previous[prevIdx])
      if (score >= MATCH_THRESHOLD) pairs.push({ newIdx, prevIdx, score })
    }
  })
  pairs.sort((a, b) => b.score - a.score)

  const usedPrev = new Set<number>()
  const assigned = new Set<number>()
  for (const { newIdx, prevIdx } of pairs) {
    if (assigned.has(newIdx) || usedPrev.has(prevIdx)) continue
    const prevBlock = previous[prevIdx]
    fresh[newIdx].node_id = prevBlock.node_id ?? mintBlockId(fresh[newIdx])
    if (fresh[newIdx].kind === 'items' && Array.isArray(fresh[newIdx].items)) {
      fresh[newIdx].items = matchItems(fresh[newIdx].items!, prevBlock.items ?? [])
    }
    assigned.add(newIdx)
    usedPrev.add(prevIdx)
  }
  // Anything unmatched: mint fresh id (and recurse into items)
  fresh.forEach((b, i) => {
    if (!assigned.has(i)) {
      b.node_id = mintBlockId(b)
      if (b.kind === 'items' && Array.isArray(b.items)) {
        b.items = matchItems(b.items, [])
      }
    }
  })
  return fresh
}

function matchItems(fresh: ContentItem[], previous: ContentItem[]): ContentItem[] {
  type Pair = { newIdx: number; prevIdx: number; score: number }
  const pairs: Pair[] = []
  fresh.forEach((newItem, newIdx) => {
    previous.forEach((prevItem, prevIdx) => {
      const score = scoreItems(newItem, prevItem)
      if (score >= MATCH_THRESHOLD) pairs.push({ newIdx, prevIdx, score })
    })
  })
  pairs.sort((a, b) => b.score - a.score)

  const usedPrev = new Set<number>()
  const assigned = new Set<number>()
  for (const { newIdx, prevIdx } of pairs) {
    if (assigned.has(newIdx) || usedPrev.has(prevIdx)) continue
    fresh[newIdx].node_id = previous[prevIdx].node_id ?? mintItemId(fresh[newIdx])
    fresh[newIdx].blocks = matchBlocks(fresh[newIdx].blocks, previous[prevIdx].blocks)
    assigned.add(newIdx)
    usedPrev.add(prevIdx)
  }
  fresh.forEach((it, i) => {
    if (!assigned.has(i)) {
      it.node_id = mintItemId(it)
      it.blocks = matchBlocks(it.blocks, [])
    }
  })
  return fresh
}

function scoreBlocks(a: ContentBlock, b: ContentBlock): number {
  if (a.kind !== b.kind) return 0
  switch (a.kind) {
    case 'cta':
      return 0.7 * ((a.url && a.url === b.url) ? 1 : 0)
           + 0.3 * slugMatch(a.label ?? '', b.label ?? '')
    case 'image':
    case 'video':
      return 0.7 * ((a.url && a.url === b.url) ? 1 : 0)
           + 0.3 * slugMatch(a.alt ?? '', b.alt ?? '')
    case 'items': {
      // Items containers: hint + size as a quick gate; nested items
      // are matched deeply in matchItems once we commit a pair.
      const hintScore = (a.hint && a.hint === b.hint) ? 0.5 : 0
      const aN = a.items?.length ?? 0
      const bN = b.items?.length ?? 0
      const denom = Math.max(1, aN, bN)
      const sizeScore = 0.5 * (1 - Math.abs(aN - bN) / denom)
      return hintScore + sizeScore
    }
    default: {
      // Text-bearing blocks (heading, description, tagline, name, quote,
      // attribution, address, question, answer, etc.) — compare on text.
      const aText = a.text ?? stripHtml(a.html ?? '')
      const bText = b.text ?? stripHtml(b.html ?? '')
      return jaccard(textTokens(aText), textTokens(bText))
    }
  }
}

function scoreItems(a: ContentItem, b: ContentItem): number {
  // First block that "names" the item — heading, person name, FAQ question
  const headOf = (it: ContentItem) =>
    it.blocks.find(blk => blk.kind === 'heading' || blk.kind === 'name' || blk.kind === 'question')?.text ?? ''
  const headScore = slugMatch(headOf(a), headOf(b))
  // Body-level overlap across all blocks
  const allText = (it: ContentItem) =>
    it.blocks.map(blk => blk.text ?? stripHtml(blk.html ?? '')).join(' ')
  const bodyScore = jaccard(textTokens(allText(a)), textTokens(allText(b)))
  return 0.5 * headScore + 0.5 * bodyScore
}

// ── Similarity primitives (local to keep the module self-contained) ───
//
// If a third module grows the same token/jaccard helpers, lift to a
// shared text-utils file. Today only this module needs them.

const MATCHER_STOPWORDS: ReadonlySet<string> = new Set([
  'the','a','an','and','or','to','of','in','on','at','for','with','is','are',
  'was','were','be','been','have','has','this','that','your','you','our','we',
  'will','what','when','where','why','how','from','they','them','their',
])

function textTokens(s: string): Set<string> {
  return new Set(
    String(s ?? '').toLowerCase().split(/[^a-z0-9']+/)
      .filter(w => w.length >= 4 && !MATCHER_STOPWORDS.has(w)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let hits = 0
  for (const w of a) if (b.has(w)) hits++
  return hits / (a.size + b.size - hits)
}

function slug(s: string): string {
  return String(s ?? '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function slugMatch(a: string, b: string): number {
  const sa = slug(a), sb = slug(b)
  if (!sa || !sb) return 0
  if (sa === sb) return 1
  return jaccard(textTokens(a), textTokens(b))
}

function randomTail(): string {
  // 4 chars of base36 — collisions vanishingly rare within one section
  return Math.random().toString(36).slice(2, 6)
}

function mintBlockId(block: ContentBlock): string {
  const seed = block.label ?? block.text ?? block.url ?? block.alt ?? block.kind
  return `${block.kind}:${slug(String(seed)) || 'node'}-${randomTail()}`
}

function mintItemId(item: ContentItem): string {
  const first = item.blocks.find(b => b.text || b.label || b.url)
  const seed = first?.text ?? first?.label ?? first?.url ?? item.hint ?? 'item'
  return `item:${slug(String(seed)) || 'node'}-${randomTail()}`
}

// ── Path resolution against ir_snapshot ──────────────────────────────
//
// field_provenance.ir_path uses a node_id-anchored syntax:
//   "blocks{node_id=heading:welcome-x7q}.text"
//   "blocks{node_id=items:steps-ab12}.items{node_id=item:find-the-desk-c4d}.blocks{node_id=description:its-located-9k1}.text"
//
// The walker traverses the IR by matching node_ids at each segment.
// Returns the value at the leaf, or undefined if any segment can't
// resolve (signals that the binding has lost its IR source — the
// caller should flip the field's provenance to `unbound`).

/** Resolve an ir_path against an IR snapshot. Returns the leaf value
 *  (string, number, etc.) or undefined if the path doesn't resolve. */
export function resolveIrPath(ir: ContentDocument | null | undefined, path: string): unknown {
  if (!ir || !path) return undefined
  const segments = path.split('.')
  // Segment shape: `arrayName{node_id=value}` or a plain field name
  // The root is always `blocks{node_id=...}` (or `blocks[N]` for legacy)
  let cursor: unknown = ir
  for (const seg of segments) {
    const arrayMatch = seg.match(/^(\w+)\{node_id=([^}]+)\}$/)
    if (arrayMatch) {
      const [, arrName, id] = arrayMatch
      const arr = (cursor as Record<string, unknown>)?.[arrName]
      if (!Array.isArray(arr)) return undefined
      cursor = arr.find(x => (x as { node_id?: string })?.node_id === id)
      if (!cursor) return undefined
    } else {
      // Plain field access
      cursor = (cursor as Record<string, unknown>)?.[seg]
      if (cursor === undefined) return undefined
    }
  }
  return cursor
}
