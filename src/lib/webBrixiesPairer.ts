/**
 * Brixies master pairer.
 *
 * Replaces cowork's per-section `template_id` choice with an
 * intent-driven, shape-matched, site-cohesive pick. Cowork ships
 * *content*; this module decides *layout*.
 *
 * Three-stage pipeline:
 *
 *   1. **Shape fingerprint** — read each brief section's `field_values`
 *      structure (top-level slots + group items + nested bullets/CTAs)
 *      and produce a `FieldShape`. Same operation on every catalog
 *      template's augmented schema → `TemplateFingerprint`.
 *
 *   2. **Archetype classifier** — assign a semantic class to each
 *      section: hero_homepage, hero_inner, feature_detail_cards,
 *      feature_team, accordion_faq, content_image_text, cta_simple,
 *      etc. Uses position + concept_id hint + structural signals
 *      (`question`/`answer` → FAQ, `name`/`title`/`email` → team).
 *
 *   3. **Score + cohesion** — for each section, score every catalog
 *      template in the archetype's allowed families. Apply boosters:
 *      curated-library member, family already locked site-wide for
 *      this archetype (hero/team/header/footer never vary across the
 *      project), shape-precise (bullets-per-item, CTA cardinality).
 *      Best score wins. Site-wide lock is computed in a second pass
 *      over all sections at once so heroes converge.
 *
 * Aggressive mode (the project default per CLAUDE.md scope): cowork's
 * `template_id` is treated purely as a tie-breaker hint and overridden
 * whenever a better shape match exists. Every override carries a
 * one-line rationale rendered in the import modal's "See what I
 * changed" panel.
 */
import { supabase } from './supabase'
import { augmentTemplate } from './webBrixiesSchemaAugment'
import { LIBRARY_CONCEPTS } from './webCuratedLibrary'
import { isButtonShapedSlot } from './cta'
import {
  extractDocument, fingerprintDocument, type DocumentFingerprint,
} from './webContentDocument'
import type {
  WebContentTemplate, WebFieldDef, WebGroupDef, WebSlotDef,
  StrategyWebProject,
} from '../types/database'

// ── Section archetype ──────────────────────────────────────────────────

export type SectionArchetype =
  | 'hero_homepage'
  | 'hero_inner'
  | 'hero_featured'
  | 'feature_card_grid'
  | 'feature_card_carousel'
  | 'feature_tabbed'
  | 'feature_detail_cards'   // cards w/ bullets or CTA per card
  | 'feature_team'
  | 'feature_unique'
  | 'content_image_text'
  | 'content_featured'
  | 'content_video'
  | 'cta_simple'
  | 'cta_callout'
  | 'accordion_faq'
  | 'process'
  | 'testimonial'
  | 'gallery'
  | 'timeline'
  | 'header'
  | 'footer'
  | 'unknown'

/** Family allow-list per archetype. The candidate pool for each
 *  section is the union of these families' templates. Mirrors the
 *  curated library's `familyFilter` per concept, plus a few catch-all
 *  fallback families for the `unknown` bucket. */
const ARCHETYPE_FAMILIES: Record<SectionArchetype, readonly string[]> = {
  hero_homepage:          ['Hero Section'],
  hero_inner:             ['Hero Section'],
  hero_featured:          ['Hero Section'],
  feature_card_grid:      ['Feature Section'],
  feature_card_carousel:  ['Feature Section'],
  feature_tabbed:         ['Feature Section'],
  feature_detail_cards:   ['Feature Section'],
  feature_team:           ['Team Section', 'Feature Section'],
  feature_unique:         ['Feature Section', 'Process Section'],
  content_image_text:     ['Content Section', 'Intro Section'],
  content_featured:       ['Content Section', 'Feature Section'],
  content_video:          ['Content Section', 'Gallery Section'],
  cta_simple:             ['CTA Section', 'Banner Section', 'Content Section'],
  cta_callout:            ['CTA Section', 'Banner Section'],
  accordion_faq:          ['FAQ Section'],
  process:                ['Process Section', 'Timeline Section'],
  testimonial:            ['Content Section', 'Feature Section'],
  gallery:                ['Gallery Section', 'Content Section'],
  timeline:               ['Timeline Section', 'Process Section'],
  header:                 ['Header'],
  footer:                 ['Footer'],
  unknown:                ['Content Section', 'Feature Section', 'CTA Section'],
}

/** Archetypes that the project should lock to ONE family across all
 *  pages — heroes must match site-wide so inner-page hero variants
 *  don't drift; team blocks should look identical; chrome (header /
 *  footer) is always shared. Feature/content/CTA stay flexible. */
const SITE_LOCKED_ARCHETYPES: ReadonlySet<SectionArchetype> = new Set([
  'hero_homepage', 'hero_inner', 'hero_featured',
  'feature_team', 'header', 'footer',
])

// ── Shape fingerprints ─────────────────────────────────────────────────

/** Boolean signals + cardinality counts that summarize what content a
 *  section / template carries. The pairer matches briefs to templates
 *  by computing this on both sides and overlapping. */
export interface FieldShape {
  has_tagline:      boolean
  has_heading:      boolean
  has_description:  boolean
  has_image:        boolean
  has_video:        boolean
  has_name:         boolean   // staff cards
  has_title:        boolean   // staff cards
  has_email:        boolean
  has_role:         boolean
  has_quote:        boolean   // testimonials
  has_date:         boolean   // events / posts
  has_speaker:      boolean   // sermons
  has_step_number:  boolean   // process
  has_question:     boolean   // FAQ
  has_answer:       boolean
  has_address:      boolean
  cta_count:        number    // 0, 1, 2+
  primary_group:    GroupShape | null  // largest top-level group
  total_groups:     number
}

export interface GroupShape {
  key:           string
  count:         number      // number of items the brief ships (or default_count for templates)
  per_item:      FieldShape  // shape of one item
  bullet_count:  number      // length of a nested bullet/list group inside an item (0 = none)
}

export interface TemplateFingerprint extends FieldShape {
  id:               string
  layer_name:       string
  family:           string
  /** Default item count for the primary group — used for "brief wants 3,
   *  template's design-time count is 4" delta scoring. */
  primary_default_count: number
}

// ── Brief shape extraction ────────────────────────────────────────────

const KEY_MAP: Array<{ keys: RegExp; signal: keyof FieldShape }> = [
  { keys: /^(tagline|eyebrow|kicker|pretitle)$/i,       signal: 'has_tagline' },
  { keys: /^(heading|title|subheading|h1|h2)$/i,        signal: 'has_heading' },
  { keys: /^(description|body|content|paragraph|info|detail|summary|caption|answer)$/i, signal: 'has_description' },
  { keys: /^(image|photo|thumbnail|avatar|picture)$/i,  signal: 'has_image' },
  { keys: /^(video|video_url|embed)$/i,                 signal: 'has_video' },
  { keys: /^(name|full_name)$/i,                        signal: 'has_name' },
  { keys: /^(title|role|position|job_title)$/i,         signal: 'has_title' },
  { keys: /^(email|contact_email)$/i,                   signal: 'has_email' },
  { keys: /^(role|position)$/i,                         signal: 'has_role' },
  { keys: /^(quote|testimonial)$/i,                     signal: 'has_quote' },
  { keys: /^(date|event_date|published_at|published_date)$/i, signal: 'has_date' },
  { keys: /^(speaker|preacher|teacher)$/i,              signal: 'has_speaker' },
  { keys: /^(step|step_number|step_count|order)$/i,     signal: 'has_step_number' },
  { keys: /^(question)$/i,                              signal: 'has_question' },
  { keys: /^(answer)$/i,                                signal: 'has_answer' },
  { keys: /^(address|location)$/i,                      signal: 'has_address' },
]

function emptyShape(): FieldShape {
  return {
    has_tagline: false, has_heading: false, has_description: false,
    has_image: false, has_video: false, has_name: false, has_title: false,
    has_email: false, has_role: false, has_quote: false, has_date: false,
    has_speaker: false, has_step_number: false, has_question: false,
    has_answer: false, has_address: false,
    cta_count: 0, primary_group: null, total_groups: 0,
  }
}

/** True when `value` looks like a non-empty meaningful payload. */
function isMeaningful(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v))      return v.length > 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.label === 'string' && o.label.trim()) return true
    if (typeof o.url   === 'string' && o.url.trim())   return true
    if (typeof o.text  === 'string' && o.text.trim())  return true
    if ('items' in o && Array.isArray(o.items) && (o.items as unknown[]).length > 0) return true
    return Object.keys(o).length > 0
  }
  return Boolean(v)
}

/** True when a key/value pair looks button-shaped — direct CTA shape
 *  or a known button-key name. */
function isCtaValue(key: string, v: unknown): boolean {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (typeof o.label === 'string' || typeof o.url === 'string'
        || typeof o.text === 'string' || typeof o.href === 'string') return true
  }
  if (typeof v === 'string') {
    return /^(cta|button|buttons|link|action)/i.test(key) && v.trim().length > 0
  }
  return false
}

/** Unwrap `{items: [...]}` group wrappers cowork ships. */
function unwrapItems(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.items)) return o.items
  }
  return null
}

/** Extract a fingerprint from a brief section's field_values.
 *
 *  As of the rebuild, this routes through `extractDocument` → the
 *  semantic IR → `fingerprintDocument`. The legacy key-name-based
 *  detection has been removed entirely — every brief now passes
 *  through the IR's shape-first classifier, so cowork's field naming
 *  conventions (`container_left`, `staff_cards`, `grid.items`, etc.)
 *  no longer drive scoring. */
export function fingerprintBrief(fieldValues: Record<string, unknown>): FieldShape {
  const doc = extractDocument({ field_values: fieldValues })
  return documentFingerprintToFieldShape(fingerprintDocument(doc))
}

/** Bridge from the IR's DocumentFingerprint to the pairer's FieldShape.
 *  Same boolean signal vector + the structural primary_group field;
 *  the only delta is that the IR's per_item omits primary_group (items
 *  inside items aren't tracked structurally — they merge flat into
 *  the parent's signals). */
function documentFingerprintToFieldShape(fp: DocumentFingerprint): FieldShape {
  const base: FieldShape = {
    has_tagline: fp.has_tagline, has_heading: fp.has_heading,
    has_description: fp.has_description, has_image: fp.has_image,
    has_video: fp.has_video, has_name: fp.has_name, has_title: fp.has_title,
    has_email: fp.has_email, has_role: fp.has_role, has_quote: fp.has_quote,
    has_date: fp.has_date, has_speaker: fp.has_speaker,
    has_step_number: fp.has_step_number, has_question: fp.has_question,
    has_answer: fp.has_answer, has_address: fp.has_address,
    cta_count: fp.cta_count, total_groups: fp.total_groups,
    primary_group: null,
  }
  if (fp.primary_group) {
    const pi = fp.primary_group.per_item
    base.primary_group = {
      key: fp.primary_group.key,
      count: fp.primary_group.count,
      bullet_count: fp.primary_group.bullet_count,
      per_item: {
        has_tagline: pi.has_tagline, has_heading: pi.has_heading,
        has_description: pi.has_description, has_image: pi.has_image,
        has_video: pi.has_video, has_name: pi.has_name, has_title: pi.has_title,
        has_email: pi.has_email, has_role: pi.has_role, has_quote: pi.has_quote,
        has_date: pi.has_date, has_speaker: pi.has_speaker,
        has_step_number: pi.has_step_number, has_question: pi.has_question,
        has_answer: pi.has_answer, has_address: pi.has_address,
        cta_count: pi.cta_count, total_groups: 0, primary_group: null,
      },
    }
  }
  return base
}

function mergeShapes(shapes: FieldShape[]): FieldShape {
  const out = emptyShape()
  for (const s of shapes) {
    for (const k of Object.keys(out) as Array<keyof FieldShape>) {
      const v = (s as Record<string, unknown>)[k]
      if (typeof v === 'boolean' && v) {
        ;(out as Record<string, unknown>)[k] = true
      }
    }
    out.cta_count    = Math.max(out.cta_count, s.cta_count)
    out.total_groups = Math.max(out.total_groups, s.total_groups)
  }
  return out
}

// ── Template fingerprint extraction ────────────────────────────────────

/** Extract a fingerprint from a template's (augmented) field schema. */
export function fingerprintTemplate(template: WebContentTemplate): TemplateFingerprint {
  const base = fingerprintFields(Array.isArray(template.fields) ? template.fields : [])
  return {
    ...base,
    id:          template.id,
    layer_name:  template.layer_name ?? template.id,
    family:      template.family ?? 'Other',
    primary_default_count: base.primary_group?.count ?? 0,
  }
}

function fingerprintFields(fields: ReadonlyArray<WebFieldDef>): FieldShape {
  const shape = emptyShape()
  let primaryGroup: GroupShape | null = null
  let primaryGroupSize = 0

  for (const f of fields) {
    if (f.kind === 'slot') {
      const slot = f as WebSlotDef
      const matched = mapSlotToSignal(slot)
      if (matched) (shape as Record<string, unknown>)[matched] = true
      if (slot.type === 'cta' || isButtonShapedSlot(slot)) shape.cta_count += 1
      if (slot.type === 'image') shape.has_image = true
      if (slot.type === 'richtext') shape.has_description = shape.has_description || /description|body|content/i.test(slot.key)
      continue
    }
    if (f.kind === 'group') {
      const g = f as WebGroupDef
      shape.total_groups += 1
      const itemSchema = Array.isArray(g.item_schema) ? g.item_schema : []
      const perItem = fingerprintFields(itemSchema)
      // Buttons group → fold into cta_count rather than treating as a
      // group; cowork & templates both use this pattern for hero buttons.
      if (/^(cta|button|buttons|action|link)s?$/i.test(g.key)) {
        const itemCtas = perItem.cta_count > 0 ? perItem.cta_count : 1
        shape.cta_count += Math.max(g.default_count, 1) * itemCtas
        continue
      }
      // Look for a nested list/bullets group inside the item schema.
      let bulletCount = 0
      for (const inner of itemSchema) {
        if (inner.kind === 'group' && !/^(cta|button|buttons)/i.test(inner.key)) {
          if (/(feature_element|list|bullets|items|points|highlights)/i.test(inner.key)
              || /(feature_element|list|bullets|items|points|highlights)/i.test(inner.layer_name ?? '')) {
            bulletCount = Math.max(bulletCount, inner.default_count ?? 0)
          }
        }
      }
      const gShape: GroupShape = {
        key:          g.key,
        count:        g.default_count ?? 1,
        per_item:     perItem,
        bullet_count: bulletCount,
      }
      if (gShape.count > primaryGroupSize) {
        primaryGroup = gShape
        primaryGroupSize = gShape.count
      }
    }
  }
  shape.primary_group = primaryGroup
  return shape
}

function mapSlotToSignal(slot: WebSlotDef): keyof FieldShape | null {
  const k = (slot.key + ' ' + (slot.layer_name ?? '') + ' ' + (slot.label ?? '')).toLowerCase()
  if (/tagline|eyebrow|kicker|pretitle/.test(k)) return 'has_tagline'
  if (/question/.test(k))                         return 'has_question'
  if (/answer/.test(k))                           return 'has_answer'
  if (/quote|testimonial/.test(k))                return 'has_quote'
  if (/speaker|preacher|teacher/.test(k))         return 'has_speaker'
  if (/step|sequence/.test(k))                    return 'has_step_number'
  if (/address|location/.test(k))                 return 'has_address'
  if (/^name|full_name/.test(k))                  return 'has_name'
  if (/^email|contact_email/.test(k))             return 'has_email'
  if (/role|position|job_title/.test(k))          return 'has_role'
  if (/^title|^subtitle/.test(k))                 return 'has_title'
  if (/heading|h1|h2/.test(k))                    return 'has_heading'
  if (/description|body|content|paragraph|info|detail|summary|caption/.test(k)) return 'has_description'
  if (/image|photo|thumbnail|avatar|picture/.test(k)) return 'has_image'
  if (/video|embed/.test(k))                      return 'has_video'
  if (/date|published/.test(k))                   return 'has_date'
  return null
}

// ── Archetype classification ──────────────────────────────────────────

export interface ClassifyContext {
  position:       number    // 0-indexed within the page
  page_slug:      string
  total_sections: number
  concept_id?:    string | null
  template_id?:   string | null   // cowork hint
}

export function classifyArchetype(
  shape: FieldShape,
  ctx: ClassifyContext,
): SectionArchetype {
  const pg     = shape.primary_group
  const itemHas = pg?.per_item ?? emptyShape()
  const isHome  = /^\/?$|^\/?home(page)?$|^\/?index$/i.test(ctx.page_slug)

  // 1. Hard signals from item shape — these win regardless of position
  //    OR concept hint. Cowork frequently mis-labels these (e.g. an
  //    "events list" page tagged `feature_tabbed`), so we trust the
  //    structural fingerprint over the editorial concept tag.
  if (itemHas.has_question && itemHas.has_answer) return 'accordion_faq'
  if (itemHas.has_name && (itemHas.has_title || itemHas.has_email || itemHas.has_role)) return 'feature_team'
  if (itemHas.has_step_number)                       return 'process'
  if (itemHas.has_quote && (itemHas.has_name || itemHas.has_title)) return 'testimonial'
  if (itemHas.has_speaker && itemHas.has_date)      return 'unknown' // sermon listing — no concept yet

  // 2. Card-with-bullets-per-card OR card-with-CTA-per-card — strong
  //    "detail cards" signal (Feature 43 / 109 pattern). This BEATS
  //    cowork's concept hint because the shape is unambiguous: if the
  //    brief carries a per-item bullet list, the layout must support
  //    one. Cowork's "feature_tabbed" tag would otherwise route a
  //    detail-cards brief to a Tab template like Feature 31 with no
  //    per-tab bullet slot, dropping the lists silently.
  if (pg && pg.count >= 2 && pg.bullet_count > 0) {
    return 'feature_detail_cards'
  }

  // 3. Concept-id hint — when cowork shipped one and the shape didn't
  //    already disambiguate it. Hints below are still subject to the
  //    family + score pool — the family check is the safety rail.
  if (ctx.concept_id) {
    const fromHint = archetypeFromConceptId(ctx.concept_id)
    if (fromHint) return fromHint
  }

  // 4. Hero — first section of any page.
  if (ctx.position === 0) {
    if (isHome) return 'hero_homepage'
    // Featured = inner page hero with conversion intent (multi-CTA).
    if (shape.cta_count >= 2) return 'hero_featured'
    return 'hero_inner'
  }

  // 5. Cards-with-CTA-per-card → still detail-cards even without bullets.
  if (pg && pg.count >= 2) {
    if (itemHas.cta_count >= 1)            return 'feature_detail_cards'
    if (itemHas.has_image && itemHas.has_description && itemHas.has_heading)
      return 'feature_card_grid'
    return 'feature_card_grid'
  }

  // 5. Video — heading + video URL.
  if (shape.has_video) return 'content_video'

  // 6. Image + body — paired content layout.
  if (shape.has_image && shape.has_heading && shape.has_description) {
    return 'content_image_text'
  }

  // 7. Last-section CTA push.
  const isLast = ctx.position === ctx.total_sections - 1
  if (shape.cta_count >= 1 && shape.has_heading && !pg && shape.has_description) {
    return isLast ? 'cta_callout' : 'cta_simple'
  }
  if (shape.cta_count >= 1 && !pg) {
    return 'cta_simple'
  }

  // 8. Featured content — heading + description + items but no card-grid signature.
  if (shape.has_heading && shape.has_description && pg) {
    return 'content_featured'
  }
  if (shape.has_heading && shape.has_description) {
    return 'content_image_text'
  }

  return 'unknown'
}

function archetypeFromConceptId(id: string): SectionArchetype | null {
  const c = id.toLowerCase()
  if (c.includes('hero_home') || c === 'hero_homepage') return 'hero_homepage'
  if (c.includes('hero_feature'))                       return 'hero_featured'
  if (c.includes('hero'))                               return 'hero_inner'
  if (c.includes('faq') || c.includes('accordion'))     return 'accordion_faq'
  if (c.includes('team') || c.includes('staff'))        return 'feature_team'
  if (c.includes('testimonial'))                        return 'testimonial'
  if (c.includes('process') || c.includes('step'))      return 'process'
  if (c.includes('timeline'))                           return 'timeline'
  if (c.includes('gallery'))                            return 'gallery'
  if (c.includes('tabbed') || c.includes('nested'))     return 'feature_tabbed'
  if (c.includes('carousel'))                           return 'feature_card_carousel'
  if (c.includes('card_grid') || c.includes('cards_grid')) return 'feature_card_grid'
  if (c.includes('cta_callout') || c.includes('callout')) return 'cta_callout'
  if (c.includes('cta_simple') || c === 'cta')          return 'cta_simple'
  if (c.includes('video'))                              return 'content_video'
  if (c.includes('image_text') || c.includes('content_image')) return 'content_image_text'
  if (c.includes('featured'))                           return 'content_featured'
  if (c.includes('header'))                             return 'header'
  if (c.includes('footer'))                             return 'footer'
  return null
}

// ── Scoring ────────────────────────────────────────────────────────────

export interface ScoreContext {
  archetype:          SectionArchetype
  librarySet:         ReadonlySet<string>
  /** Family forced for this archetype by the site-wide cohesion pass —
   *  templates in this family get a large boost. */
  lockedFamily:       string | null
  /** Families already used in OTHER sections of this same archetype in
   *  this import batch — softer boost (project-wide convergence). */
  batchFamilies:      ReadonlySet<string>
  /** Cowork's hint, if any — used as a small tie-breaker boost. */
  coworkHint:         string | null
}

export function scoreTemplate(
  briefShape: FieldShape,
  template: TemplateFingerprint,
  ctx: ScoreContext,
): number {
  let s = 0

  // ── Slot match ───────────────────────────────────────────────────────
  const slotSignals: Array<keyof FieldShape> = [
    'has_tagline', 'has_heading', 'has_description', 'has_image', 'has_video',
    'has_name', 'has_title', 'has_email', 'has_role', 'has_quote',
    'has_date', 'has_speaker', 'has_step_number', 'has_question',
    'has_answer', 'has_address',
  ]
  for (const k of slotSignals) {
    const briefHas = Boolean(briefShape[k])
    const tplHas   = Boolean(template[k])
    if (briefHas && tplHas)        s += 4
    else if (briefHas && !tplHas)  s -= 8     // brief insists, template can't hold
    else if (!briefHas && tplHas)  s -= 1     // extra slots are mostly harmless
  }

  // ── CTA cardinality ──────────────────────────────────────────────────
  if (briefShape.cta_count === 0 && template.cta_count === 0) s += 2
  else if (briefShape.cta_count > 0) {
    if (template.cta_count >= briefShape.cta_count) s += 8
    else if (template.cta_count >= 1)               s += 2
    else                                            s -= 12
  }

  // ── Primary group shape (the largest signal in card-heavy briefs) ───
  if (briefShape.primary_group) {
    if (!template.primary_group) {
      // Brief expects a card grid, template is a flat section → severe
      // penalty. Filters out content/CTA sections for feature briefs.
      s -= 40
    } else {
      const bg = briefShape.primary_group
      const tg = template.primary_group

      // Item count delta (close enough = full credit, far off = small penalty).
      const delta = Math.abs(bg.count - tg.count)
      s += Math.max(0, 8 - delta * 1.5)

      // Per-item slot overlap.
      for (const k of slotSignals) {
        const bh = Boolean(bg.per_item[k])
        const th = Boolean(tg.per_item[k])
        if (bh && th)        s += 4
        else if (bh && !th)  s -= 7
      }

      // Per-item CTA cardinality.
      if (bg.per_item.cta_count > 0) {
        if (tg.per_item.cta_count > 0) s += 10
        else                           s -= 12
      }

      // Bullet list per item — strongest signal for "detail cards"
      // pattern (Feature 43 vs Feature 31).
      if (bg.bullet_count > 0) {
        if (tg.bullet_count > 0) s += 25
        else                     s -= 25
      }
    }
  } else if (template.primary_group && template.primary_default_count >= 3) {
    // Template wants a multi-card grid but brief has none → penalty.
    s -= 15
  }

  // ── Cohesion + library boosts ────────────────────────────────────────
  if (ctx.librarySet.has(template.id))                     s += 20
  if (ctx.lockedFamily && template.family === ctx.lockedFamily) s += 50
  if (ctx.batchFamilies.has(template.family))              s += 10
  if (ctx.coworkHint && ctx.coworkHint === template.id)    s += 5

  return s
}

// ── Site state for cohesion ────────────────────────────────────────────

export interface SiteState {
  /** Templates already used per archetype, with family counts. The
   *  pairer uses these to lock heroes / team blocks / footers to one
   *  family site-wide. */
  familyCountsByArchetype: Map<SectionArchetype, Map<string, number>>
  /** Set of template IDs currently in the project's curated library
   *  (effective bindings — explicit + system defaults). */
  librarySet: ReadonlySet<string>
}

export interface ProjectExistingSection {
  template_id:    string
  family:         string
  archetype:      SectionArchetype
}

/** Pull every section across every page in this project, classify by
 *  archetype, and tally families per archetype. The pairer uses the
 *  most-used family for any `SITE_LOCKED_ARCHETYPES` as the locked
 *  family for new picks. */
export async function loadProjectSiteState(
  project: StrategyWebProject,
  librarySet: ReadonlySet<string>,
): Promise<SiteState> {
  const familyCountsByArchetype = new Map<SectionArchetype, Map<string, number>>()

  // 1. Load existing pages + sections.
  const { data: pages } = await supabase
    .from('web_pages')
    .select('id, slug')
    .eq('web_project_id', project.id)
    .eq('archived', false)
  if (!pages || pages.length === 0) return { familyCountsByArchetype, librarySet }

  const pageIds = (pages as Array<{ id: string; slug: string }>).map(p => p.id)
  const slugById = new Map(
    (pages as Array<{ id: string; slug: string }>).map(p => [p.id, p.slug]),
  )

  const { data: sections } = await supabase
    .from('web_sections')
    .select('id, web_page_id, sort_order, content_template_id, source_field_values, field_values')
    .in('web_page_id', pageIds)
    .order('sort_order')
  if (!sections || sections.length === 0) return { familyCountsByArchetype, librarySet }

  // Group sections per page for total_sections context.
  const sectionsByPage = new Map<string, Array<{
    sort_order: number
    template_id: string | null
    field_values: Record<string, unknown>
  }>>()
  for (const s of sections as Array<{
    web_page_id: string
    sort_order: number
    content_template_id: string | null
    source_field_values: Record<string, unknown> | null
    field_values:        Record<string, unknown> | null
  }>) {
    const arr = sectionsByPage.get(s.web_page_id) ?? []
    arr.push({
      sort_order:  s.sort_order,
      template_id: s.content_template_id,
      field_values: (s.source_field_values ?? s.field_values ?? {}) as Record<string, unknown>,
    })
    sectionsByPage.set(s.web_page_id, arr)
  }

  // 2. Resolve template families for every referenced template.
  const tplIds = Array.from(new Set(sections
    .map(s => (s as { content_template_id?: string | null }).content_template_id)
    .filter((x): x is string => !!x)))
  const familyById = new Map<string, string>()
  if (tplIds.length > 0) {
    const { data: tplRows } = await supabase
      .from('web_content_templates')
      .select('id, family')
      .in('id', tplIds)
    for (const t of (tplRows ?? []) as Array<{ id: string; family: string | null }>) {
      familyById.set(t.id, t.family ?? 'Other')
    }
  }

  // 3. Classify every section and tally.
  for (const [pageId, pageSections] of sectionsByPage) {
    const slug = slugById.get(pageId) ?? ''
    pageSections.sort((a, b) => a.sort_order - b.sort_order)
    for (let i = 0; i < pageSections.length; i++) {
      const s   = pageSections[i]
      if (!s.template_id) continue
      const fam = familyById.get(s.template_id)
      if (!fam) continue
      const shape = fingerprintBrief(s.field_values)
      const arch  = classifyArchetype(shape, {
        position:       i,
        page_slug:      slug,
        total_sections: pageSections.length,
        template_id:    s.template_id,
      })
      const fmap = familyCountsByArchetype.get(arch) ?? new Map<string, number>()
      fmap.set(fam, (fmap.get(fam) ?? 0) + 1)
      familyCountsByArchetype.set(arch, fmap)
    }
  }

  return { familyCountsByArchetype, librarySet }
}

/** Return the family that should be locked for this archetype across
 *  the project, or null when nothing is locked (archetype isn't in
 *  SITE_LOCKED_ARCHETYPES or no prior sections informed it). */
export function lockedFamilyFor(
  archetype: SectionArchetype,
  state: SiteState,
): string | null {
  if (!SITE_LOCKED_ARCHETYPES.has(archetype)) return null
  const map = state.familyCountsByArchetype.get(archetype)
  if (!map || map.size === 0) return null
  // Pick the family with the highest count; ties broken alphabetically
  // for determinism.
  let bestFamily: string | null = null
  let bestCount = -1
  for (const [fam, cnt] of map.entries()) {
    if (cnt > bestCount || (cnt === bestCount && (bestFamily === null || fam < bestFamily))) {
      bestFamily = fam
      bestCount = cnt
    }
  }
  return bestFamily
}

// ── Pair result + main entry ──────────────────────────────────────────

export interface SectionPairInput {
  sort_order:   number
  page_slug:    string
  position:     number
  total_sections: number
  concept_id?:  string | null
  template_id_hint?: string | null
  field_values: Record<string, unknown>
}

export interface SectionPairResult {
  sort_order:    number
  archetype:     SectionArchetype
  picked_id:     string
  picked_name:   string
  picked_family: string
  score:         number
  /** Cowork's original pick (when different from picked_id) or the
   *  literal `null` when cowork didn't bind. */
  cowork_id:     string | null
  /** True when our pick differs from cowork's hint. */
  overridden:    boolean
  /** Human-readable explanation of the choice — shown in the import
   *  modal's "See what I changed" panel. */
  rationale:     string
  /** Set to null when no template in the archetype's family list
   *  scored above zero — caller should fall back to library_fallback
   *  picker or surface as an unbindable section. */
  fallback_used: boolean
}

/** Main entry. Inputs:
 *   - `sections` — every section in the import batch (across all
 *     pages), pre-flattened with page context.
 *   - `catalog` — every catalog template, augmented.
 *   - `librarySet` — effective curated library binding ids.
 *   - `siteState` — pre-loaded from loadProjectSiteState.
 *
 *   Two passes: (a) score every section per its archetype, (b)
 *   recompute site-locked-family choices (so a hero we just paired
 *   contributes its family to the locked set for OTHER heroes in the
 *   same batch), then re-score and emit final picks.
 */
export function pairSections(
  sections: SectionPairInput[],
  catalog: WebContentTemplate[],
  librarySet: ReadonlySet<string>,
  siteState: SiteState,
): SectionPairResult[] {
  // Build a fingerprint cache for the catalog.
  const fingerprints = new Map<string, TemplateFingerprint>()
  const byFamily = new Map<string, TemplateFingerprint[]>()
  for (const t of catalog) {
    const fp = fingerprintTemplate(t)
    fingerprints.set(t.id, fp)
    const arr = byFamily.get(fp.family) ?? []
    arr.push(fp)
    byFamily.set(fp.family, arr)
  }

  // PASS A — classify + score with the project's existing site state.
  const provisional: Array<{
    input:     SectionPairInput
    shape:     FieldShape
    archetype: SectionArchetype
    bestId:    string | null
    bestScore: number
    bestRationale: string
    coworkId:  string | null
  }> = []

  for (const input of sections) {
    const shape = fingerprintBrief(input.field_values)
    const archetype = classifyArchetype(shape, {
      position:       input.position,
      page_slug:      input.page_slug,
      total_sections: input.total_sections,
      concept_id:     input.concept_id,
      template_id:    input.template_id_hint,
    })
    const allowedFamilies = ARCHETYPE_FAMILIES[archetype]
    const pool: TemplateFingerprint[] = []
    for (const fam of allowedFamilies) {
      pool.push(...(byFamily.get(fam) ?? []))
    }
    const lockedFamily = lockedFamilyFor(archetype, siteState)
    const result = scoreAll(pool, shape, {
      archetype,
      librarySet,
      lockedFamily,
      batchFamilies: new Set(),
      coworkHint:    input.template_id_hint ?? null,
    })
    provisional.push({
      input, shape, archetype,
      bestId:        result?.id ?? null,
      bestScore:     result?.score ?? -Infinity,
      bestRationale: result?.rationale ?? 'No catalog match.',
      coworkId:      input.template_id_hint ?? null,
    })
  }

  // PASS B — derive batch family choices from pass A's picks for the
  // SITE_LOCKED_ARCHETYPES, then re-score those sections so all
  // heroes in this batch agree on one family (the most common).
  const batchFamilyByArchetype = new Map<SectionArchetype, Map<string, number>>()
  for (const p of provisional) {
    if (!p.bestId) continue
    if (!SITE_LOCKED_ARCHETYPES.has(p.archetype)) continue
    const fp = fingerprints.get(p.bestId)
    if (!fp) continue
    const fmap = batchFamilyByArchetype.get(p.archetype) ?? new Map<string, number>()
    fmap.set(fp.family, (fmap.get(fp.family) ?? 0) + 1)
    batchFamilyByArchetype.set(p.archetype, fmap)
  }
  const batchLockedFamily = new Map<SectionArchetype, string>()
  for (const [arch, fmap] of batchFamilyByArchetype) {
    // Combine batch counts with siteState counts for stable lock-in:
    // the family that's most-used across BOTH new and existing wins.
    const combined = new Map<string, number>(fmap)
    const existing = siteState.familyCountsByArchetype.get(arch)
    if (existing) {
      for (const [fam, cnt] of existing) {
        combined.set(fam, (combined.get(fam) ?? 0) + cnt)
      }
    }
    let bestFam: string | null = null
    let bestCnt = -1
    for (const [fam, cnt] of combined.entries()) {
      if (cnt > bestCnt || (cnt === bestCnt && (bestFam === null || fam < bestFam))) {
        bestFam = fam
        bestCnt = cnt
      }
    }
    if (bestFam) batchLockedFamily.set(arch, bestFam)
  }

  // PASS C — re-score with the BATCH-locked families folded in.
  const out: SectionPairResult[] = []
  for (const p of provisional) {
    const allowedFamilies = ARCHETYPE_FAMILIES[p.archetype]
    const pool: TemplateFingerprint[] = []
    for (const fam of allowedFamilies) pool.push(...(byFamily.get(fam) ?? []))
    const lockedFamily = batchLockedFamily.get(p.archetype)
                       ?? lockedFamilyFor(p.archetype, siteState)
    const batchFamilies = new Set<string>()
    for (const q of provisional) {
      if (q !== p && q.archetype === p.archetype && q.bestId) {
        const fp = fingerprints.get(q.bestId)
        if (fp) batchFamilies.add(fp.family)
      }
    }
    const result = scoreAll(pool, p.shape, {
      archetype:     p.archetype,
      librarySet,
      lockedFamily,
      batchFamilies,
      coworkHint:    p.coworkId,
    })

    const picked = result?.fingerprint ?? null
    const cowork = p.coworkId
    const overridden = picked != null && cowork != null && picked.id !== cowork

    let rationale = result?.rationale ?? p.bestRationale
    if (overridden) {
      rationale = explainOverride({
        archetype: p.archetype,
        briefShape: p.shape,
        cowork:    fingerprints.get(cowork) ?? null,
        picked,
      })
    } else if (!cowork && picked) {
      rationale = `Auto-paired: ${describeArchetype(p.archetype)} — ${picked.layer_name} matches the brief's shape.`
    }

    out.push({
      sort_order:    p.input.sort_order,
      archetype:     p.archetype,
      picked_id:     picked?.id ?? '',
      picked_name:   picked?.layer_name ?? '',
      picked_family: picked?.family ?? '',
      score:         result?.score ?? 0,
      cowork_id:     cowork,
      overridden,
      rationale,
      fallback_used: picked == null,
    })
  }

  return out
}

function scoreAll(
  pool: TemplateFingerprint[],
  brief: FieldShape,
  ctx: ScoreContext,
): { id: string; fingerprint: TemplateFingerprint; score: number; rationale: string } | null {
  let bestFp: TemplateFingerprint | null = null
  let bestScore = -Infinity
  for (const fp of pool) {
    const s = scoreTemplate(brief, fp, ctx)
    if (s > bestScore) {
      bestScore = s
      bestFp = fp
    }
  }
  if (!bestFp) return null
  return {
    id:          bestFp.id,
    fingerprint: bestFp,
    score:       bestScore,
    rationale:   `Best fit for ${describeArchetype(ctx.archetype)} — score ${bestScore.toFixed(0)}.`,
  }
}

// ── Rationale generation ─────────────────────────────────────────────

function describeArchetype(a: SectionArchetype): string {
  return ARCHETYPE_LABELS[a] ?? a
}

const ARCHETYPE_LABELS: Record<SectionArchetype, string> = {
  hero_homepage:         'Homepage Hero',
  hero_inner:            'Inner Page Hero',
  hero_featured:         'Featured Page Hero',
  feature_card_grid:     'Card Grid',
  feature_card_carousel: 'Card Carousel',
  feature_tabbed:        'Tabbed Feature',
  feature_detail_cards:  'Detail Cards (bullets + CTAs)',
  feature_team:          'Team / Staff Cards',
  feature_unique:        'Custom Feature',
  content_image_text:    'Image + Text Content',
  content_featured:      'Featured Content',
  content_video:         'Video Section',
  cta_simple:            'Simple CTA Banner',
  cta_callout:           'Callout CTA',
  accordion_faq:         'FAQ Accordion',
  process:               'Process Steps',
  testimonial:           'Testimonial',
  gallery:               'Gallery',
  timeline:              'Timeline',
  header:                'Header',
  footer:                'Footer',
  unknown:               'General Content',
}

function explainOverride(args: {
  archetype:  SectionArchetype
  briefShape: FieldShape
  cowork:     TemplateFingerprint | null
  picked:     TemplateFingerprint
}): string {
  const { archetype, briefShape, cowork, picked } = args
  const reasons: string[] = []
  const bg = briefShape.primary_group

  if (cowork && cowork.family !== picked.family) {
    reasons.push(`Family ${cowork.family} → ${picked.family}.`)
  }

  if (bg && cowork?.primary_group && bg.bullet_count > 0 && cowork.primary_group.bullet_count === 0) {
    reasons.push(`Brief ships a bullet list per item; ${cowork.layer_name} has no per-item bullets.`)
  }
  if (bg && cowork?.primary_group && bg.per_item.cta_count > 0 && cowork.primary_group.per_item.cta_count === 0) {
    reasons.push(`Brief has a CTA per item; ${cowork.layer_name} has no per-item CTA slot.`)
  }
  if (bg && !cowork?.primary_group) {
    reasons.push(`Brief expects a repeating item group; ${cowork?.layer_name ?? 'previous pick'} is a flat layout.`)
  }
  if (briefShape.has_tagline && cowork && !cowork.has_tagline) {
    reasons.push('Brief carries a tagline; previous template had no tagline slot.')
  }

  const lead = `${describeArchetype(archetype)} → ${picked.layer_name}.`
  if (reasons.length === 0) {
    return `${lead} Better shape match across the project.`
  }
  return `${lead} ${reasons.join(' ')}`
}

// ── Concept-shape canonical mapping (export for diagnostics) ────────

/** For each library concept id, the archetype it represents and the
 *  shape signals it expects. Surfaces in the import modal as
 *  context for the strategist; the pairer doesn't strictly need this
 *  (archetype is computed from brief shape) but it keeps the curated
 *  library and the pairer aligned. */
export const CONCEPT_ARCHETYPES: Record<string, SectionArchetype> = {
  hero_homepage:        'hero_homepage',
  hero_inner:           'hero_inner',
  hero_featured:        'hero_featured',
  feature_card_grid:    'feature_card_grid',
  feature_card_carousel: 'feature_card_carousel',
  feature_tabbed:       'feature_tabbed',
  feature_unique:       'feature_unique',
  feature_team:         'feature_team',
  content_image_text:   'content_image_text',
  content_featured:     'content_featured',
  content_video:        'content_video',
  cta_simple:           'cta_simple',
  cta_callout:          'cta_callout',
  accordion_faq:        'accordion_faq',
  card_ministry:        'feature_card_grid',
  card_staff:           'feature_team',
  card_event:           'feature_card_grid',
  card_info:            'feature_card_grid',
  card_sermon:          'feature_card_grid',
  card_process:         'process',
  card_testimonial:     'testimonial',
  nav_header:           'header',
  nav_footer:           'footer',
  archive_filter:       'unknown',
  archive_current_series: 'content_featured',
  single_event:         'unknown',
  single_post:          'unknown',
  single_team:          'unknown',
}

/** Pre-augment the catalog. Helper for callers who already have raw
 *  template rows from Supabase — calls augmentTemplate so palette /
 *  hero-tagline / FAQ inferences are folded in before fingerprinting. */
export function augmentCatalog(rows: WebContentTemplate[]): WebContentTemplate[] {
  return rows.map(augmentTemplate)
}

// LIBRARY_CONCEPTS import is referenced by name to ensure this module
// stays linked to the canonical concept list; the actual data is read
// inside CONCEPT_ARCHETYPES above for clarity.
void LIBRARY_CONCEPTS
