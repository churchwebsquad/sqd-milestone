/**
 * Runtime schema augmenter for the Brixies catalog.
 *
 * The catalog import was lossy in three recurring ways:
 *
 *   1. Groups with `item_schema: []` and a non-zero `default_count`
 *      — the Brixies source HTML has real text inside each item but
 *      the importer didn't capture it as slots.
 *
 *   2. Cards / list items have sibling text layers (e.g. Icon + Info,
 *      or Heading + Description + CTA) where only one was surfaced
 *      because the importer assumed the FIRST data-layer child was
 *      the only content.
 *
 *   3. Image slots that are actually FRAME divs wrapping per-card
 *      text — typed as `image` but the wrapped Heading / Description
 *      were never exposed.
 *
 * This file walks `source_html` end-to-end and adds slots for every
 * text-bearing `data-layer` that the existing schema doesn't already
 * cover, deeply. Augmentation is purely additive — existing slots are
 * preserved by key and layer_name.
 */
import type {
  WebContentTemplate, WebFieldDef, WebSlotDef, WebGroupDef,
} from '../types/database'

// ── Pattern matching for inferred slot type ─────────────────────────

/** Layer-name-driven slot type inference. The augmenter consults this
 *  to classify a candidate text element into the right slot shape.
 *  Order matters — more specific patterns first. */
const TEXT_LAYER_PATTERNS: Array<{
  test: (norm: string) => boolean
  type: 'text' | 'richtext'
  keyBase: string
  label?: string
  heading_level?: 1 | 2 | 3 | 4 | 5 | 6
  max_chars?: number
  scope?: string
}> = [
  // Eyebrow / tagline — short single-line above headings
  { test: matches('tagline', 'eyebrow', 'kicker', 'pretitle'),
    type: 'text',     keyBase: 'tagline',     max_chars: 60 },

  // Author / reading time / date — utility text in card meta rows
  { test: matches('author', 'byline'),
    type: 'text',     keyBase: 'author',      max_chars: 60, scope: 'author' },
  { test: matches('readingtime', 'readtime'),
    type: 'text',     keyBase: 'reading_time', max_chars: 20, scope: 'post' },

  // Question / answer for FAQ accordions
  { test: matches('question'),
    type: 'text',     keyBase: 'question',    max_chars: 200, heading_level: 3 },
  { test: matches('answer'),
    type: 'richtext', keyBase: 'answer',      max_chars: 400 },

  // Headings (broad — also covers "title", "subtitle", "subheading")
  { test: matches('subheading', 'subtitle'),
    type: 'text',     keyBase: 'subheading',  max_chars: 100, heading_level: 3 },
  { test: matches('heading', 'title'),
    type: 'text',     keyBase: 'heading',     max_chars: 100, heading_level: 3 },

  // Body / description / info / detail — long-form richtext
  { test: matches('description', 'body', 'content', 'paragraph',
                  'info', 'detail', 'summary', 'caption'),
    type: 'richtext', keyBase: 'description', max_chars: 400 },

  // List-item text (some templates name them explicitly)
  { test: matches('listitemtitle', 'itemtitle'),
    type: 'text',     keyBase: 'item_title',  max_chars: 100 },
  { test: matches('listitemdescription', 'itembody'),
    type: 'richtext', keyBase: 'item_body',   max_chars: 300 },

  // Buttons (CTAs whose label is a plain text element with scope=button)
  { test: matches('contact', 'buttonlabel', 'buttontext', 'cta'),
    type: 'text',     keyBase: 'button_label', label: 'Button label',
    max_chars: 30, scope: 'button' },

  // Labels / tags / categories — short single-line
  { test: matches('label', 'tag', 'category', 'badge'),
    type: 'text',     keyBase: 'label',       max_chars: 40 },
]

function matches(...needles: string[]): (norm: string) => boolean {
  const norms = needles.map(s => s.toLowerCase().replace(/[_\s-]+/g, ''))
  return (norm) => norms.some(n => norm === n || norm.endsWith(n) || norm.startsWith(n) || norm.includes(n))
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_\s-]+/g, '')
}

// ── Top-level entry ─────────────────────────────────────────────────

export function augmentTemplate(template: WebContentTemplate): WebContentTemplate {
  if (typeof window === 'undefined' || !template.source_html) return template
  const doc = new DOMParser().parseFromString(template.source_html, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return template

  // Build a set of layer_names already addressed ANYWHERE in the
  // template's schema tree (not just within the current group being
  // augmented). Timeline 16 surfaced the need: slide.heading targets
  // layer "Year", but the augmenter walking card's subtree (also
  // inside the same Slide element) would re-discover "Year" and add
  // it as card.heading — two slots editing the same visual element.
  const globalLayers = collectAllSchemaLayers(template.fields)

  let augmented = template.fields.map(f => augmentField(f, root, globalLayers))

  // FAQ inference — catalog templates like faq-section-1 ship with a
  // schema of only heading + description, yet their source_html
  // contains a container holding N sibling accordion frames (each with
  // a bold question + body answer). Without a synthesized items group
  // the importer has nowhere to put cowork's `faq_items` payload and
  // the section renders empty toggles.
  //
  // GATED to FAQ-family templates only. The previous unrestricted
  // version mis-fired on hero/feature templates whose top container
  // also has "2+ children each with some bold text" (heading +
  // description + buttons) and synthesized a spurious `items` group
  // that the renderer then tried to expand, mangling the layout.
  if (isFaqTemplate(template) && !hasFaqShapedGroup(augmented)) {
    const faqGroup = inferFaqGroup(root, new Set([
      ...collectAllSchemaLayers(augmented),
      ...globalLayers,
    ]))
    if (faqGroup) augmented = [...augmented, faqGroup]
  }

  // Hero tagline injection — every hero with a heading + description
  // should expose an editable tagline so the strategist has the same
  // eyebrow slot across the catalog. About half the Brixies hero
  // templates ship a Tagline layer (49, 55, 65, 77, 80, 85, etc.),
  // the rest don't (1, 5, 13, 14, 27, 32, 34, 41, 43, 44, 56, 9,
  // etc.). We synthesize one for the latter: inject a styled Tagline
  // <div> directly above the source's Heading and surface a top-level
  // `tagline` slot in the schema pointing at it.
  let mutatedSourceHtml: string | null = null
  if (isHeroTemplate(template) && !hasTaglineSlot(augmented)) {
    const injection = injectHeroTagline(root, augmented)
    if (injection) {
      augmented = injection.augmented
      mutatedSourceHtml = root.outerHTML
    }
  }

  // NOTE: top-level inference (inferUnaddressedFields) was attempted but
  // introduced layer_name collisions with existing fields — the renderer's
  // indexByLayer Map would overwrite the user-valued field with an empty
  // augmented one, blanking out substituted content. The function is kept
  // below for reference and future work; not invoked. Lorem visibility
  // is handled by neutralizeLoremPlaceholders in the renderer instead.

  // Final pass — deduplicate field keys. The binder writes to
  // `out[field.key]`, so two top-level fields with the same key cause
  // the second one to overwrite the first (visible symptom: Hero
  // Section 32 has two `image` groups; only the second binds, leaving
  // the first image grid empty). 9 templates in the current catalog
  // ship duplicate keys at the top level — banner-4, content-16,
  // cta-48, feature-27, footer-26, footer-29, hero-32, hero-34,
  // single-post-8. Rather than 9 data fixes (and ongoing risk for
  // future Brixies imports), we rename collisions at augment time:
  // the first occurrence keeps the key, subsequent ones get `_2`,
  // `_3`, etc. Defensive — leaves single-key templates untouched.
  augmented = dedupeFieldKeys(augmented)

  const fieldsChanged = JSON.stringify(augmented) !== JSON.stringify(template.fields)
  if (!fieldsChanged && !mutatedSourceHtml) return template
  return {
    ...template,
    fields: augmented,
    ...(mutatedSourceHtml ? { source_html: mutatedSourceHtml } : {}),
  }
}

/** Rename duplicate `key` values across an array of fields. The first
 *  occurrence keeps its key; subsequent ones get `<key>_2`, `<key>_3`,
 *  etc. Skips fields without a string key (defensive — augmentField
 *  should never emit those, but the bind path tolerates them). */
function dedupeFieldKeys(fields: ReadonlyArray<WebFieldDef>): WebFieldDef[] {
  const seen = new Map<string, number>()
  const out: WebFieldDef[] = []
  for (const f of fields) {
    const k = (f as { key?: unknown }).key
    if (typeof k !== 'string' || !k) { out.push(f); continue }
    const count = seen.get(k) ?? 0
    if (count === 0) {
      out.push(f)
      seen.set(k, 1)
    } else {
      const newKey = `${k}_${count + 1}`
      out.push({ ...(f as object), key: newKey } as WebFieldDef)
      seen.set(k, count + 1)
    }
  }
  return out
}

/** True when the template is in the Hero Section family — matches the
 *  catalog's `family` value or an id prefix. */
function isHeroTemplate(template: WebContentTemplate): boolean {
  if (typeof template.family === 'string' && /hero/i.test(template.family)) return true
  if (typeof template.id === 'string' && /^hero[-_]/i.test(template.id)) return true
  return false
}

/** Walks `schema` deeply looking for any slot named tagline/eyebrow/
 *  kicker/pretitle. Returns true if found — the augmenter then skips
 *  the synthesis pass for this template. */
function hasTaglineSlot(schema: ReadonlyArray<WebFieldDef>): boolean {
  for (const f of schema) {
    if (f.kind === 'slot') {
      const key = (f.key ?? '').toLowerCase()
      const layer = (f.layer_name ?? '').toLowerCase()
      if (/tagline|eyebrow|kicker|pretitle/.test(key)) return true
      if (/tagline|eyebrow|kicker|pretitle/.test(layer)) return true
    }
    if (f.kind === 'group' && Array.isArray(f.item_schema)) {
      if (hasTaglineSlot(f.item_schema)) return true
    }
  }
  return false
}

/** Find the first top-level Heading-shaped element in the source —
 *  the element above which a Tagline should be inserted. Prefers
 *  layers literally named Heading / Title; falls back to large bold
 *  text styles when the source uses generic layer names. */
function findHeroHeading(root: Element): Element | null {
  const candidates = Array.from(root.querySelectorAll('[data-layer]'))
  for (const el of candidates) {
    const layer = (el.getAttribute('data-layer') ?? '').toLowerCase()
    if (/^(heading|title|h1|hero[-_ ]?title)$/i.test(layer)) return el
  }
  // Style-based fallback: a large bold text node sitting in the upper
  // half of the section's content stack.
  for (const el of candidates) {
    const style = el.getAttribute('style') ?? ''
    const fontMatch = /font-size:\s*([\d.]+)px/i.exec(style)
    const weightMatch = /font-weight:\s*(\d+)/i.exec(style)
    const px = fontMatch ? parseFloat(fontMatch[1]) : NaN
    const weight = weightMatch ? parseInt(weightMatch[1], 10) : NaN
    if (!isNaN(px) && px >= 32 && !isNaN(weight) && weight >= 600) return el
  }
  return null
}

/** Inject a styled Tagline element directly above the heading and
 *  return an updated schema with a `tagline` slot at the top. The
 *  caller serializes `root.outerHTML` after we mutate it in place.
 *  Style mirrors hero-section-49's existing tagline (the catalog's
 *  canonical example) — neutral color, Inter font, weight 600,
 *  alignment inherited from the heading so center-aligned hero
 *  variants keep their alignment. */
function injectHeroTagline(
  root: Element,
  augmented: ReadonlyArray<WebFieldDef>,
): { augmented: WebFieldDef[] } | null {
  // If the source already carries a tagline-shaped element, surface
  // it as a top-level slot instead of injecting a second one.
  const existing = Array.from(root.querySelectorAll('[data-layer]')).find(el => {
    const layer = (el.getAttribute('data-layer') ?? '').toLowerCase()
    return /^(tagline|eyebrow|kicker|pretitle)$/.test(layer)
  })
  if (existing) {
    const layerName = existing.getAttribute('data-layer') ?? 'Tagline'
    const taglineSlot: WebSlotDef = {
      kind: 'slot',
      key: 'tagline',
      layer_name: layerName,
      type: 'text',
      max_chars: 60,
      label: 'Tagline',
    }
    return { augmented: [taglineSlot, ...augmented] }
  }

  const heading = findHeroHeading(root)
  if (!heading) return null
  const headingParent = heading.parentElement
  if (!headingParent) return null

  // Inherit alignment from the heading so we don't fight its layout.
  const hStyle = heading.getAttribute('style') ?? ''
  const alignMatch = /text-align:\s*([a-z]+)/i.exec(hStyle)
  const align = alignMatch ? alignMatch[1] : 'inherit'

  const doc = root.ownerDocument
  const tagline = doc.createElement('div')
  tagline.setAttribute('data-layer', 'Tagline')
  tagline.setAttribute('class', 'Tagline')
  tagline.setAttribute('style', [
    `text-align: ${align}`,
    'color: #6B5CE7',                 // brand Purple Mid — distinguishes from heading
    'font-size: 14px',
    'font-family: Inter',
    'font-weight: 600',
    'line-height: 22px',
    'letter-spacing: 0.08em',
    'text-transform: uppercase',
    'word-wrap: break-word',
    'margin-bottom: 4px',
  ].join('; '))
  tagline.textContent = 'Tagline'

  headingParent.insertBefore(tagline, heading)

  const taglineSlot: WebSlotDef = {
    kind: 'slot',
    key: 'tagline',
    layer_name: 'Tagline',
    type: 'text',
    max_chars: 60,
    label: 'Tagline',
  }
  return { augmented: [taglineSlot, ...augmented] }
}

/** Only fire FAQ inference on templates that ARE FAQ templates.
 *  Matches by family name ("FAQ Section" in the catalog) or by id
 *  prefix (`faq-` / `faq_`). Anything else — hero, feature, content,
 *  timeline — skips the FAQ pass to avoid synthesizing spurious
 *  groups whose layer_name collides with the renderer's expansion. */
function isFaqTemplate(template: WebContentTemplate): boolean {
  if (typeof template.family === 'string' && /faq/i.test(template.family)) return true
  if (typeof template.id === 'string' && /^faq[-_]/i.test(template.id)) return true
  return false
}

/** True when `schema` already contains a group whose item_schema has
 *  both a question-shaped slot and an answer-shaped slot, deeply. */
function hasFaqShapedGroup(schema: ReadonlyArray<WebFieldDef>): boolean {
  for (const f of schema) {
    if (f.kind === 'group' && Array.isArray(f.item_schema)) {
      const hasQ = f.item_schema.some(s => s.kind === 'slot'
        && (/question/i.test(s.key) || /question/i.test(s.layer_name ?? '')))
      const hasA = f.item_schema.some(s => s.kind === 'slot'
        && (/answer/i.test(s.key) || /answer/i.test(s.layer_name ?? '')))
      if (hasQ && hasA) return true
      if (hasFaqShapedGroup(f.item_schema)) return true
    }
  }
  return false
}

/** Walk the source DOM looking for a container holding 2+ sibling
 *  data-layer children that each contain a styled (bold) text +
 *  optional longer-body text — the classic accordion shape. Returns a
 *  synthesized group field with `question` + `answer` item slots so
 *  the binder + reconcile-alias matcher can route FAQ payloads here. */
function inferFaqGroup(root: Element, existingLayers: Set<string>): WebGroupDef | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode() as Element | null

  while (node) {
    const layer = node.getAttribute('data-layer')
    if (!layer) { node = walker.nextNode() as Element | null; continue }
    const norm = normalize(layer)
    if (existingLayers.has(norm)) { node = walker.nextNode() as Element | null; continue }

    const dataChildren = Array.from(node.children).filter(c => c.hasAttribute('data-layer'))
    if (dataChildren.length < 2) { node = walker.nextNode() as Element | null; continue }

    // Each child must look like an accordion frame: contain at least
    // one bold-shaped text descendant somewhere in its subtree.
    const allFaqShaped = dataChildren.every(child => {
      const cands = collectTextCandidates(child)
      return cands.some(c => isBoldText(c.element))
    })
    if (!allFaqShaped) { node = walker.nextNode() as Element | null; continue }

    // Pick the richest sibling as the item template — the one with
    // the most distinct text candidates. Frame 57 in faq-section-1
    // is the only sibling that has the answer paragraph; the rest are
    // header-only stubs.
    const richest = dataChildren.reduce((best, cur) =>
      collectTextCandidates(cur).length > collectTextCandidates(best).length ? cur : best,
    dataChildren[0])
    const cands = collectTextCandidates(richest)
    let questionEl: Element | null = null
    let answerEl:   Element | null = null
    for (const c of cands) {
      if (!questionEl && isBoldText(c.element)) {
        questionEl = c.element
      } else if (!answerEl && !isBoldText(c.element)
          && (c.element.textContent ?? '').trim().length > 40) {
        answerEl = c.element
      }
    }
    if (!questionEl) { node = walker.nextNode() as Element | null; continue }

    const itemSchema: WebSlotDef[] = [
      {
        kind: 'slot',
        key: 'question',
        layer_name: questionEl.getAttribute('data-layer') ?? '',
        type: 'text',
        max_chars: 200,
        heading_level: 3,
      },
    ]
    if (answerEl) {
      itemSchema.push({
        kind: 'slot',
        key: 'answer',
        layer_name: answerEl.getAttribute('data-layer') ?? '',
        type: 'richtext',
        max_chars: 400,
      })
    }

    return {
      kind: 'group',
      key: 'items',
      layer_name: layer,
      default_count: dataChildren.length,
      item_schema: itemSchema,
    }
  }
  return null
}

function isBoldText(el: Element): boolean {
  const style = el.getAttribute('style') ?? ''
  const m = /font-weight:\s*(\d+)/i.exec(style)
  const w = m ? parseInt(m[1], 10) : NaN
  return !isNaN(w) && w >= 600
}

function augmentField(field: WebFieldDef, sourceRoot: Element, globalLayers: Set<string>): WebFieldDef {
  if (field.kind === 'slot') return field
  return augmentGroup(field, sourceRoot, globalLayers)
}

// ── Top-level augmentation ──────────────────────────────────────────
//
// After per-field augmentation, scan source_html for data-layer
// elements the schema doesn't cover at all (neither as a top-level
// field nor as a descendant of one). Add them as new top-level fields
// so the strategist can edit every text element in the rendered
// preview. Handles:
//   • Feature 103's section-level heading + description (peers to the
//     card group)
//   • FAQ 10's accordion_left (peer to accordion_right, 3 sample
//     question/answer frames)
//   • Any template where the importer captured the dominant
//     container but missed siblings carrying real content.
//
// Inference rules:
//   • If a container has 2+ direct data-layer children that each carry
//     substantive text in their subtree → emit a GROUP, with item
//     schema derived from the first sibling.
//   • Else if the element has its own substantive text → emit a SLOT.
//   • Skip elements that are descendants of an already-addressed field
//     so we don't duplicate.

function inferUnaddressedFields(
  root: Element,
  augmented: ReadonlyArray<WebFieldDef>,
): WebFieldDef[] {
  const addressed = new Set<Element>()
  const markAddressedDeep = (el: Element) => {
    addressed.add(el)
    for (const desc of Array.from(el.querySelectorAll('[data-layer]'))) {
      addressed.add(desc)
    }
  }
  for (const field of augmented) {
    const el = findElementByLayer(root, field.layer_name ?? field.key)
    if (el) markAddressedDeep(el)
  }

  const existingLayers = collectAllSchemaLayers(augmented)
  const usedKeys = new Set<string>(augmented.map(f => f.key))
  const additions: WebFieldDef[] = []

  // Top-down walk: when an element is uncovered and substantive, emit
  // a field and stop descending (its descendants will be covered by
  // the new field). When it's covered, descend through its children
  // to look for unaddressed peers.
  const visit = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!child.hasAttribute('data-layer')) {
        visit(child)
        continue
      }
      if (addressed.has(child)) {
        // Already-addressed elements have markAddressedDeep'd their
        // own subtree. Don't recurse — peers at deeper levels that
        // weren't marked were intentionally skipped (the addressed
        // field owns them).
        continue
      }

      const dataChildren = Array.from(child.children)
        .filter(c => c.hasAttribute('data-layer'))
      const childrenWithText = dataChildren.filter(c => subtreeHasText(c))

      if (childrenWithText.length >= 2) {
        const group = buildGroupFromContainer(
          child, childrenWithText, existingLayers, usedKeys,
        )
        if (group) {
          additions.push(group)
          markAddressedDeep(child)
          continue
        }
      }

      // Leaf with substantive direct text → slot.
      if (hasSubstantiveText(child)) {
        const layer = child.getAttribute('data-layer') ?? ''
        const norm = normalize(layer)
        if (existingLayers.has(norm)) {
          visit(child)
          continue
        }
        const pattern = inferSlotShape(layer, child)
        if (pattern) {
          const key = uniqueKey(pattern.keyBase, usedKeys)
          usedKeys.add(key)
          existingLayers.add(norm)
          additions.push({
            kind: 'slot',
            key,
            layer_name: layer,
            type: pattern.type,
            ...(pattern.max_chars && { max_chars: pattern.max_chars }),
            ...(pattern.heading_level && { heading_level: pattern.heading_level }),
            ...(pattern.label && { label: pattern.label }),
            ...(pattern.scope && { scope: pattern.scope }),
          })
          markAddressedDeep(child)
          continue
        }
      }

      visit(child)
    }
  }
  visit(root)
  return additions
}

function subtreeHasText(el: Element): boolean {
  if (hasSubstantiveText(el)) return true
  const all = el.querySelectorAll('[data-layer]')
  for (const desc of Array.from(all)) {
    if (hasSubstantiveText(desc)) return true
  }
  return false
}

function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

function buildGroupFromContainer(
  container: Element,
  itemSamples: Element[],
  existingLayers: Set<string>,
  usedKeys: Set<string>,
): WebGroupDef | null {
  const containerLayer = container.getAttribute('data-layer') ?? ''
  const norm = normalize(containerLayer)
  if (existingLayers.has(norm)) return null

  // Homogeneity guard: only treat container's children as sibling
  // instances when they share substantial inner structure. Without
  // this, a section wrapper holding heterogeneous content (Heading +
  // Description + Card group + CTA) gets mis-identified as a "group
  // of 4 items", and the renderer's expandGroup clobbers the whole
  // section by replacing children with empty clones.
  //
  // Pass when EITHER (a) all samples share the same data-layer NAME
  // (classic same-name siblings: Card / Card / Card), OR (b) all
  // samples' descendant-layer sets intersect on 2+ layers (FAQ
  // pattern: each Frame N contains Heading 4 + Text).
  const sampleNames = itemSamples.map(s => normalize(s.getAttribute('data-layer') ?? ''))
  const allSameName = sampleNames.every(n => n === sampleNames[0])

  if (!allSameName) {
    const sampleLayerSets = itemSamples.map(sample => {
      const set = new Set<string>()
      for (const desc of Array.from(sample.querySelectorAll('[data-layer]'))) {
        const n = normalize(desc.getAttribute('data-layer') ?? '')
        if (n) set.add(n)
      }
      return set
    })
    let intersection = new Set<string>(sampleLayerSets[0])
    for (let i = 1; i < sampleLayerSets.length; i++) {
      const next = new Set<string>()
      for (const v of intersection) if (sampleLayerSets[i].has(v)) next.add(v)
      intersection = next
    }
    if (intersection.size < 2) return null
  }

  const itemEl = itemSamples[0]
  const candidates = collectTextCandidates(itemEl)
  const itemSchema: WebSlotDef[] = []
  const seenLayers = new Set<string>()
  const itemKeys = new Set<string>()

  for (const cand of candidates) {
    const candNorm = normalize(cand.layer)
    if (seenLayers.has(candNorm)) continue
    const pattern = inferSlotShape(cand.layer, cand.element)
    if (!pattern) continue
    const key = uniqueKey(pattern.keyBase, itemKeys)
    itemKeys.add(key)
    seenLayers.add(candNorm)
    itemSchema.push({
      kind: 'slot',
      key,
      layer_name: cand.layer,
      type: pattern.type,
      ...(pattern.max_chars && { max_chars: pattern.max_chars }),
      ...(pattern.heading_level && { heading_level: pattern.heading_level }),
      ...(pattern.label && { label: pattern.label }),
      ...(pattern.scope && { scope: pattern.scope }),
    })
  }

  if (itemSchema.length === 0) return null

  const baseKey = sanitizeKey(containerLayer)
  const key = uniqueKey(baseKey, usedKeys)
  usedKeys.add(key)
  existingLayers.add(norm)

  return {
    kind: 'group',
    key,
    layer_name: containerLayer,
    default_count: itemSamples.length,
    item_schema: itemSchema,
  }
}

// ── Group augmentation ──────────────────────────────────────────────

function augmentGroup(group: WebGroupDef, sourceRoot: Element, globalLayers: Set<string>): WebGroupDef {
  // Palette-referenced groups (item_template_ref) get their content
  // from another template, not their own item_schema — pass through
  // unchanged so the augmenter doesn't crash on a missing array.
  if (group.item_template_ref) return group
  if (!Array.isArray(group.item_schema)) {
    return { ...group, item_schema: [] }
  }
  const recursedSchema = group.item_schema.map(f => augmentField(f, sourceRoot, globalLayers))

  const groupEl = findElementByLayer(sourceRoot, group.layer_name ?? group.key)
  if (!groupEl) {
    return { ...group, item_schema: recursedSchema }
  }

  // Decide whether groupEl is the ITEM TEMPLATE or a CONTAINER of items.
  //
  //   • If recursedSchema has an entry whose layer_name matches one of
  //     groupEl's direct data-layer children → groupEl is a container,
  //     and that child is the item template. (Row List → Item list,
  //     Grid container → Card.)
  //
  //   • Otherwise → groupEl IS the item template, regardless of its
  //     own data-layer children. (List Item → Icon + Info: the item
  //     template is the whole List Item, both children are content.)
  //
  // For single_instance_hint=true groups (Card with default_count=1)
  // AND numbered_sibling_variants=true groups (Card 01, Card 02 as
  // sibling instances), groupEl IS always the item template — the
  // matching-child logic would mistakenly walk into one of the item
  // slots' source elements (e.g. into the Buttons wrapper) and
  // re-introduce inner labels as redundant slots we deliberately
  // dedupe'd.
  const schemaLayers = recursedSchema.map(f => normalize(f.layer_name ?? f.key))
  const directDataChildren = Array.from(groupEl.children).filter(c => c.hasAttribute('data-layer'))
  const matchingChild = (group.single_instance_hint === true || group.numbered_sibling_variants === true)
    ? undefined
    : directDataChildren.find(c => {
        const layer = normalize(c.getAttribute('data-layer') ?? '')
        return schemaLayers.includes(layer)
      })
  const itemEl = matchingChild ?? groupEl

  // existingLayers covers everything in recursedSchema's tree PLUS
  // every layer addressed elsewhere in the template. Without the
  // globalLayers merge, augmenting a deeply nested group would
  // re-discover layers that a peer/ancestor group already covers
  // (Timeline 16 slide.heading="Year" vs card-level augmenter
  // finding "Year" inside card's subtree).
  const existingLayers = new Set<string>([
    ...collectAllSchemaLayers(recursedSchema),
    ...globalLayers,
  ])

  // Also mark descendants of CTA slot elements as covered. applyCta
  // writes user-typed labels into the deepest text-bearing leaf of
  // each CTA wrapper at render time, so a separate "button_label"
  // slot for that inner leaf would just be a duplicate UI for the
  // same data — and the cross-template dedupe script removes them.
  // Without this, the augmenter would re-add them on every load.
  // Walks the full recursedSchema tree (not just top level) so CTAs
  // buried in nested groups (Feature 38's button_card inside card)
  // get their inner labels marked too.
  const markCtaDescendants = (fields: ReadonlyArray<WebFieldDef>): void => {
    if (!Array.isArray(fields)) return
    for (const f of fields) {
      if (f.kind === 'slot' && f.type === 'cta' && f.layer_name) {
        const ctaEl = findElementByLayer(sourceRoot, f.layer_name)
        if (ctaEl) {
          for (const desc of Array.from(ctaEl.querySelectorAll('[data-layer]'))) {
            const n = normalize(desc.getAttribute('data-layer') ?? '')
            if (n) existingLayers.add(n)
          }
        }
      }
      if (f.kind === 'group') markCtaDescendants(f.item_schema)
    }
  }
  markCtaDescendants(recursedSchema)

  // Palette-ref subgroups (item_template_ref) own their entire source
  // subtree — the renderer substitutes the picked Card template's
  // markup in place of the palette element. Surface no slots for any
  // data-layer descendant of a palette-ref subgroup's element, or the
  // augmenter would otherwise expose phantom "Contact" / "Heading"
  // slots that have no effect (the palette substitution wipes them).
  const paletteSubtreeElements = new Set<Element>()
  const markPaletteSubtrees = (fields: ReadonlyArray<WebFieldDef>): void => {
    if (!Array.isArray(fields)) return
    for (const f of fields) {
      if (f.kind === 'group' && f.item_template_ref && f.layer_name) {
        const palEl = findElementByLayer(sourceRoot, f.layer_name)
        if (palEl) {
          paletteSubtreeElements.add(palEl)
          for (const d of Array.from(palEl.querySelectorAll('[data-layer]'))) {
            paletteSubtreeElements.add(d)
            const n = normalize(d.getAttribute('data-layer') ?? '')
            if (n) existingLayers.add(n)
          }
        }
      }
      if (f.kind === 'group') markPaletteSubtrees(f.item_schema)
    }
  }
  markPaletteSubtrees(recursedSchema)

  // Don't re-add a slot whose layer IS the group's own layer UNLESS
  // groupEl itself carries editable text. Two cases qualify:
  //   • Leaf text (Hero 37 heading group whose source element itself
  //     carries the "Lorem" text — no data-layer children).
  //   • Mixed text + children (Content 80 Counter div carries "4+"
  //     directly AND has Counter info as a data-layer child — the
  //     matchingChild logic redirects itemEl to Counter info, so the
  //     "4+" would be lost without this allowance).
  const groupOwnLayer = normalize(group.layer_name ?? group.key)
  const groupElIsLeafText = hasSubstantiveText(groupEl)

  // Walk every text-bearing data-layer in itemEl's subtree (and itemEl
  // itself when it's a leaf with text).
  const candidates = collectTextCandidates(itemEl)

  // When matchingChild redirected us into a sub-element (e.g. Counter
  // group's itemEl became Counter info), groupEl's own direct text is
  // outside that walk and would be lost — Content 80's "4+" lives on
  // the Counter div itself, with Counter info as a separate child. Pull
  // groupEl's own substantive text into the candidate list so it lands
  // as a slot in the augmented item_schema.
  if (itemEl !== groupEl && hasSubstantiveText(groupEl)) {
    const groupLayer = groupEl.getAttribute('data-layer')
    if (groupLayer) candidates.unshift({ layer: groupLayer, element: groupEl })
  }

  const additions: WebSlotDef[] = []
  const seenKeys = new Set<string>()
  const seenLayers = new Set<string>()

  for (const cand of candidates) {
    const norm = normalize(cand.layer)
    if (existingLayers.has(norm)) continue
    if (seenLayers.has(norm)) continue
    if (norm === groupOwnLayer && !groupElIsLeafText) continue

    const pattern = inferSlotShape(cand.layer, cand.element)
    if (!pattern) continue
    if (seenKeys.has(pattern.keyBase)) continue

    seenKeys.add(pattern.keyBase)
    seenLayers.add(norm)

    additions.push({
      kind: 'slot',
      key: ensureUniqueKey(pattern.keyBase, recursedSchema, additions),
      layer_name: cand.layer,
      type: pattern.type,
      ...(pattern.max_chars && { max_chars: pattern.max_chars }),
      ...(pattern.heading_level && { heading_level: pattern.heading_level }),
      ...(pattern.label && { label: pattern.label }),
      ...(pattern.scope && { scope: pattern.scope }),
    })
  }

  // Image slots that are actually frame divs containing text get
  // sibling text slots in the parent's item_schema.
  const imageFrameSlots = expandImageFrameSlots(recursedSchema, itemEl, additions, existingLayers)

  if (additions.length === 0 && imageFrameSlots.length === 0) {
    return { ...group, item_schema: recursedSchema }
  }
  return {
    ...group,
    item_schema: [...recursedSchema, ...additions, ...imageFrameSlots],
  }
}

// ── Candidate collection ────────────────────────────────────────────

interface TextCandidate { layer: string; element: Element }

/** Collect every data-layer descendant of `root` that owns substantive
 *  text directly (not via a child element). Includes `root` itself
 *  when it's a leaf with text. */
function collectTextCandidates(root: Element): TextCandidate[] {
  const out: TextCandidate[] = []
  const rootLayer = root.getAttribute('data-layer')
  if (rootLayer && hasSubstantiveText(root)) {
    out.push({ layer: rootLayer, element: root })
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode() as Element | null
  while (node) {
    const layer = node.getAttribute('data-layer')
    if (layer && hasSubstantiveText(node)) {
      out.push({ layer, element: node })
    }
    node = walker.nextNode() as Element | null
  }
  return out
}

/** Element has its own substantive text — at least one direct text
 *  node with non-whitespace, non-trivial content. Excludes pure
 *  decorative numbers ("01") and dimension placeholders ("504×378"). */
function hasSubstantiveText(el: Element): boolean {
  let total = ''
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) total += (child.nodeValue ?? '')
  }
  const trimmed = total.trim()
  if (!trimmed) return false
  if (/^\d{1,3}$/.test(trimmed)) return false
  if (/^Step\s+\d{1,3}$/i.test(trimmed)) return false
  if (/^\d{2,5}\s*[×x*]\s*\d{2,5}$/i.test(trimmed)) return false
  return true
}

// ── Slot shape inference ────────────────────────────────────────────

interface InferredShape {
  type: 'text' | 'richtext'
  keyBase: string
  label?: string
  heading_level?: 1 | 2 | 3 | 4 | 5 | 6
  max_chars?: number
  scope?: string
}

/** Decide what kind of slot to add for a text-bearing element.
 *  Brixies layer names are unreliable (FAQ 10 layers are literally
 *  the source's lorem-ipsum text), so we lean on STYLE signals
 *  (font-size + font-weight) over name patterns. The pattern list
 *  still helps pick a clean key/label when the name IS semantic. */
function inferSlotShape(layer: string, element: Element): InferredShape | null {
  // Inspect inline style first — Brixies emits all typography
  // inline so this is reliable.
  const style = element.getAttribute('style') ?? ''
  const fontMatch = /font-size:\s*([\d.]+)px/i.exec(style)
  const weightMatch = /font-weight:\s*(\d+)/i.exec(style)
  const px = fontMatch ? parseFloat(fontMatch[1]) : NaN
  const weight = weightMatch ? parseInt(weightMatch[1], 10) : NaN
  const isBold = !isNaN(weight) && weight >= 600
  const isBig = !isNaN(px) && px >= 28
  const isMedium = !isNaN(px) && px >= 18 && px < 28
  const isSmall = !isNaN(px) && px < 18

  // Semantic name pattern — honor if it matches, but only as a key/
  // label hint (we still let style override type when the name is
  // generic like "Frame 56" or pure lorem-ipsum).
  const norm = normalize(layer)
  const pattern = TEXT_LAYER_PATTERNS.find(p => p.test(norm))
  const isGenericName = /^frame\d+$/i.test(layer)
    || /lorem\s+ipsum/i.test(layer)
    || /^path/i.test(layer)
    || /^material/i.test(layer)

  if (pattern && !isGenericName) {
    return {
      type: pattern.type, keyBase: pattern.keyBase, max_chars: pattern.max_chars,
      heading_level: pattern.heading_level, label: pattern.label, scope: pattern.scope,
    }
  }

  // Pure style-based inference for generic / lorem-named layers.
  if (isBold && isBig) {
    return { type: 'text', keyBase: 'heading', max_chars: 100, heading_level: 2 }
  }
  if (isBold && isMedium) {
    return { type: 'text', keyBase: 'heading', max_chars: 100, heading_level: 3 }
  }
  if (isBold && isSmall) {
    return { type: 'text', keyBase: 'label', max_chars: 60 }
  }
  if (isBig) {
    return { type: 'text', keyBase: 'heading', max_chars: 100, heading_level: 2 }
  }
  // Default: medium / small body text — richtext if long-form, text if short.
  const textLen = (element.textContent ?? '').trim().length
  if (textLen > 60 || isMedium) {
    return { type: 'richtext', keyBase: 'description', max_chars: 400 }
  }
  return { type: 'text', keyBase: sanitizeKey(layer), max_chars: 100 }
}

/** Brixies designs sometimes ship layer_names that are the lorem
 *  placeholder copy itself ("Lorem ipsum dolor sit amet", "Consectetur
 *  adipiscing elit", "Sed do eiusmod tempor"). When the augmenter
 *  hoists those layer_names into field keys, we end up with garbage
 *  like `lorem_ipsum_dolor_sit_amet` in the inspector. Detect the
 *  pattern and fall back to a semantic key derived from the slot's
 *  intent. Caller still needs to pass that intent through; this
 *  function returns the raw sanitized key unless the layer text is
 *  recognizably lorem. */
const LOREM_PATTERN = /\b(lorem\s+ipsum|dolor\s+sit\s+amet|consectetur\s+adipiscing|sed\s+do\s+eiusmod|incididunt|aliqua|enim\s+ad\s+minim|veniam|exercitation|ullamco|laboris|nostrud|deserunt\s+mollit|cupidatat|excepteur|occaecat)\b/i

function isLoremLayer(layer: string): boolean {
  return LOREM_PATTERN.test(layer)
}

function sanitizeKey(layer: string): string {
  if (isLoremLayer(layer)) {
    // Use a generic semantic key so the inspector reads cleanly. The
    // bind path still works because `pickBlockForSlot` resolves by
    // intent (slot.type / scope), not by key — only the visible label
    // changes. Caller (`augmentField`) can pass a more contextual key
    // when it knows the slot's role (heading / description / etc.);
    // this is the catch-all fallback.
    return 'text_item'
  }
  return layer.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field'
}

// ── Schema layer collection ─────────────────────────────────────────

function collectAllSchemaLayers(schema: ReadonlyArray<WebFieldDef>): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(schema)) return out
  for (const f of schema) {
    out.add(normalize(f.layer_name ?? f.key))
    if (f.kind === 'group' && Array.isArray(f.item_schema)) {
      for (const inner of collectAllSchemaLayers(f.item_schema)) out.add(inner)
    }
  }
  return out
}

function ensureUniqueKey(
  base: string,
  existing: ReadonlyArray<WebFieldDef>,
  additions: ReadonlyArray<WebFieldDef>,
): string {
  const used = new Set<string>([
    ...existing.map(f => f.key),
    ...additions.map(f => f.key),
  ])
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

// ── Image-frame promotion ───────────────────────────────────────────

/** For each image slot in `schema`, find its element. If the element
 *  is a non-img frame containing text descendants, return new sibling
 *  text slots so the strategist can edit the wrapped content. */
function expandImageFrameSlots(
  schema: ReadonlyArray<WebFieldDef>,
  scopeEl: Element,
  alreadyAdded: ReadonlyArray<WebFieldDef>,
  inheritedLayers: Set<string> = new Set(),
): WebSlotDef[] {
  const out: WebSlotDef[] = []
  // Walk schema DEEPLY (not just top level) so nested groups' inner
  // slots are counted as "already covered". Without this, Feature
  // 109's slide group sees an Image frame containing Heading and
  // Description elements but doesn't realize card.item_schema (one
  // level deeper) already has heading_card + description_card slots
  // pointing at those same elements — and re-adds them as
  // peer-of-card slots at the slide level.
  const existingLayers = new Set<string>(inheritedLayers)
  for (const layer of collectAllSchemaLayers(schema)) existingLayers.add(layer)
  for (const f of alreadyAdded) {
    existingLayers.add(normalize(f.layer_name ?? f.key))
  }
  // Walk the schema tree (deeply) to find image slots
  const imageSlots = collectImageSlots(schema)
  for (const slot of imageSlots) {
    const imgEl = findElementByLayer(scopeEl, slot.layer_name ?? slot.key)
    if (!imgEl) continue
    if (imgEl.tagName.toLowerCase() === 'img') continue
    const cands = collectTextCandidates(imgEl)
    const seen = new Set<string>()
    for (const cand of cands) {
      const norm = normalize(cand.layer)
      if (existingLayers.has(norm)) continue
      if (seen.has(norm)) continue
      const pattern = inferSlotShape(cand.layer, cand.element)
      if (!pattern) continue
      seen.add(norm)
      out.push({
        kind: 'slot',
        key: ensureUniqueKey(pattern.keyBase, schema, [...alreadyAdded, ...out]),
        layer_name: cand.layer,
        type: pattern.type,
        ...(pattern.max_chars && { max_chars: pattern.max_chars }),
        ...(pattern.heading_level && { heading_level: pattern.heading_level }),
        ...(pattern.label && { label: pattern.label }),
        ...(pattern.scope && { scope: pattern.scope }),
      })
    }
  }
  return out
}

function collectImageSlots(schema: ReadonlyArray<WebFieldDef>): WebSlotDef[] {
  const out: WebSlotDef[] = []
  if (!Array.isArray(schema)) return out
  for (const f of schema) {
    if (f.kind === 'slot' && f.type === 'image') out.push(f)
    else if (f.kind === 'group' && Array.isArray(f.item_schema)) out.push(...collectImageSlots(f.item_schema))
  }
  return out
}

// ── DOM lookup ──────────────────────────────────────────────────────

function findElementByLayer(root: Element, layerName: string): Element | null {
  const target = normalize(layerName)
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode() as Element | null
  while (node) {
    const l = node.getAttribute('data-layer')
    if (l && normalize(l) === target) return node
    node = walker.nextNode() as Element | null
  }
  return null
}
