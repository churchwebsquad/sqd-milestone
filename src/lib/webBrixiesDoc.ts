/**
 * Bridge between a Brixies TipTap document and a section's field_values.
 *
 * The editor's source of truth is one TipTap doc per section. The bound
 * template still defines the slot schema, so on save we walk the doc
 * and stuff each Brixies block into the right slot:
 *
 *   - <h1>/<h2>/<h3>          → heading slot (by level — H1 wins for the
 *                                 section's heading, H2 → tagline-shaped
 *                                 slot when present, else first
 *                                 heading-shaped slot found)
 *   - <div data-bx-tagline>   → tagline slot
 *   - <div data-bx-cta>       → CTA-shaped slots (first cta slot, then
 *                                 the buttons group)
 *   - <p>/<ul>/<ol>           → body / description slot (richtext type)
 *
 * On LOAD: invert. Build doc HTML from field_values so the editor
 * shows the bound content as a flowing doc.
 *
 * Groups (cards, accordions) aren't yet represented in the doc — they
 * still render as a separate form below the editor (Phase 2).
 */
import type {
  WebContentTemplate, WebSlotDef, WebGroupDef,
} from '../types/database'

function canonical(s: string): string {
  return s.toLowerCase().replace(/[_\s-]+/g, '')
}

function isTaglineSlot(slot: WebSlotDef): boolean {
  const c = canonical(slot.key)
  return c.includes('tagline') || c.includes('eyebrow') || c.includes('kicker')
}

function isHeadingSlot(slot: WebSlotDef): boolean {
  const c = canonical(slot.key)
  return !!slot.heading_level || c === 'h' || c.includes('heading') || c.includes('title')
}

function isBodySlot(slot: WebSlotDef): boolean {
  if (slot.type !== 'richtext') return false
  const c = canonical(slot.key)
  return c.includes('body') || c.includes('description') || c.includes('content')
    || c.includes('intro') || c === 'd'
}

function isCtaSlot(slot: WebSlotDef): boolean {
  return slot.type === 'cta'
}

function isButtonLabelSlot(slot: WebSlotDef): boolean {
  if (slot.type !== 'text') return false
  if (slot.scope === 'button') return true
  return /button|cta/i.test(slot.label ?? '') || /^buttons?$/i.test(slot.layer_name ?? '')
}

function isCtaGroup(group: WebGroupDef): boolean {
  const c = canonical(group.key)
  return c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')
}

function isCardShapedGroup(group: WebGroupDef): boolean {
  const c = canonical(group.key)
  if (isCtaGroup(group)) return false
  return c.includes('card') || c === 'items' || c === 'features' || c === 'tiles'
    || c === 'blocks' || c === 'list' || c === 'rows' || c === 'pillars'
    || c === 'tiers' || c === 'programs' || c === 'members' || c === 'groups'
    || c === 'classes' || c === 'events' || c === 'steps' || c === 'doctrines'
    || c === 'values' || c === 'routing'
}

function isImageSlot(slot: WebSlotDef): boolean {
  return slot.type === 'image'
}

function findCardHeadingKey(itemSchema: ReadonlyArray<{ kind: 'slot' | 'group'; key: string } & Record<string, unknown>>): string | null {
  for (const f of itemSchema) {
    if (f.kind !== 'slot') continue
    const c = canonical(f.key)
    if (c.includes('heading') || c === 'h' || c.includes('title') || c.includes('name')
        || c.includes('label')) return f.key
  }
  return null
}
function findCardBodyKey(itemSchema: ReadonlyArray<{ kind: 'slot' | 'group'; key: string; type?: string } & Record<string, unknown>>): string | null {
  for (const f of itemSchema) {
    if (f.kind !== 'slot') continue
    if (f.type === 'richtext') return f.key
    const c = canonical(f.key)
    if (c.includes('body') || c.includes('description') || c.includes('content')) return f.key
  }
  return null
}
function findCardCtaKey(itemSchema: ReadonlyArray<{ kind: 'slot' | 'group'; key: string; type?: string; scope?: string } & Record<string, unknown>>): string | null {
  for (const f of itemSchema) {
    if (f.kind !== 'slot') continue
    if (f.type === 'cta') return f.key
    if (f.type === 'text' && f.scope === 'button') return f.key
  }
  return null
}

// ── field_values → doc HTML (LOAD) ────────────────────────────────────

/** Build the initial doc HTML from a bound section's field_values. The
 *  resulting HTML is what the BrixiesEditor renders as its starting
 *  content; the editor then becomes the source of truth until save. */
export function fieldValuesToDocHtml(
  values: Record<string, unknown>,
  template: WebContentTemplate,
): string {
  const parts: string[] = []

  // Tagline first (if the template defines one and the value exists).
  for (const f of template.fields) {
    if (f.kind !== 'slot') continue
    if (!isTaglineSlot(f)) continue
    const v = values[f.key]
    if (typeof v === 'string' && v.trim() !== '') {
      parts.push(`<div data-bx-tagline data-bx-label="TAGLINE" data-bx-kind="tagline" class="brixies-tagline">${escapeHtml(v)}</div>`)
    }
  }

  // Heading next — H1 by heading_level=1, else H2.
  for (const f of template.fields) {
    if (f.kind !== 'slot') continue
    if (!isHeadingSlot(f) || isTaglineSlot(f)) continue
    const v = values[f.key]
    if (typeof v !== 'string' || v.trim() === '') continue
    const level = f.heading_level ?? 1
    parts.push(`<h${level}>${escapeHtml(v)}</h${level}>`)
  }

  // Body (richtext) — pass through HTML.
  for (const f of template.fields) {
    if (f.kind !== 'slot') continue
    if (!isBodySlot(f)) continue
    const v = values[f.key]
    if (typeof v !== 'string' || v.trim() === '') continue
    parts.push(v)
  }

  // Image slots (top-level only — card-internal images render inside the card).
  for (const f of template.fields) {
    if (f.kind !== 'slot' || !isImageSlot(f)) continue
    const v = values[f.key]
    if (typeof v === 'string' && v.trim() !== '') {
      parts.push(renderImageNode(v))
    }
  }

  // Top-level CTAs and buttons group items.
  for (const f of template.fields) {
    if (f.kind === 'slot' && isCtaSlot(f)) {
      const v = values[f.key] as { label?: string; url?: string } | undefined
      if (v?.label || v?.url) {
        parts.push(renderCtaNode(v?.label ?? '', v?.url ?? ''))
      }
    } else if (f.kind === 'group' && isCtaGroup(f)) {
      const items = Array.isArray(values[f.key]) ? values[f.key] as Array<Record<string, unknown>> : []
      for (const item of items) {
        const ctaSlot = f.item_schema.find((s): s is WebSlotDef =>
          s.kind === 'slot' && isCtaSlot(s)
        )
        if (ctaSlot && typeof item[ctaSlot.key] === 'object') {
          const cta = item[ctaSlot.key] as { label?: string; url?: string }
          parts.push(renderCtaNode(cta.label ?? '', cta.url ?? ''))
          continue
        }
        const labelSlot = f.item_schema.find((s): s is WebSlotDef =>
          s.kind === 'slot' && isButtonLabelSlot(s)
        )
        if (labelSlot) {
          const label = (item[labelSlot.key] as string | undefined) ?? ''
          const url = (item.__cta_url as string | undefined) ?? ''
          if (label || url) parts.push(renderCtaNode(label, url))
        }
      }
    }
  }

  // Card-shaped groups — render the first one as a Card Grid block.
  for (const f of template.fields) {
    if (f.kind !== 'group' || !isCardShapedGroup(f)) continue
    const items = Array.isArray(values[f.key]) ? values[f.key] as Array<Record<string, unknown>> : []
    if (items.length === 0) continue
    const headingKey = findCardHeadingKey(f.item_schema as never)
    const bodyKey = findCardBodyKey(f.item_schema as never)
    const ctaKey = findCardCtaKey(f.item_schema as never)
    const cardHtml = items.map(item => {
      const inner: string[] = []
      if (headingKey && typeof item[headingKey] === 'string' && item[headingKey] !== '') {
        inner.push(`<h3>${escapeHtml(item[headingKey] as string)}</h3>`)
      }
      if (bodyKey) {
        const bv = item[bodyKey]
        if (typeof bv === 'string' && bv.trim() !== '') {
          // Body might be richtext (already HTML) or plain text.
          if (/<[a-z][^>]*>/i.test(bv)) inner.push(bv)
          else inner.push(`<p>${escapeHtml(bv)}</p>`)
        }
      }
      if (ctaKey) {
        const cv = item[ctaKey]
        if (typeof cv === 'object' && cv !== null) {
          const cta = cv as { label?: string; url?: string }
          inner.push(renderCtaNode(cta.label ?? '', cta.url ?? ''))
        } else if (typeof cv === 'string' && cv !== '') {
          const url = (item.__cta_url as string | undefined) ?? ''
          inner.push(renderCtaNode(cv, url))
        }
      }
      if (inner.length === 0) inner.push('<p></p>')
      return `<div data-bx-card data-bx-label="CARD" data-bx-kind="group" class="brixies-card">${inner.join('')}</div>`
    }).join('')
    parts.push(`<div data-bx-card-grid data-bx-label="CARD GRID" data-bx-kind="group" class="brixies-card-grid">${cardHtml}</div>`)
    break  // Only the first card-shaped group is doc-handled for now.
  }

  return parts.join('') || '<p></p>'
}

function renderImageNode(src: string): string {
  return `<div data-bx-image data-bx-label="IMAGE" data-bx-kind="image" data-src="${escapeAttr(src)}" class="brixies-image"></div>`
}

function renderCtaNode(label: string, url: string): string {
  return `<div data-bx-cta data-bx-label="CTA" data-bx-kind="cta" data-label="${escapeAttr(label)}" data-url="${escapeAttr(url)}" class="brixies-cta"></div>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;'
    : c === '<' ? '&lt;'
    : c === '>' ? '&gt;'
    : c === '"' ? '&quot;'
    : '&#39;')
}
function escapeAttr(s: string): string { return escapeHtml(s) }

// ── doc HTML → field_values (SAVE) ────────────────────────────────────

export interface DocToFieldsResult {
  field_values: Record<string, unknown>
  /** Brixies blocks that didn't find a target slot — surfaced so the
   *  caller can stash them as overflow rather than dropping silently. */
  unmapped: Array<{ kind: 'cta'; label: string; url: string }>
}

/** Parse a Brixies doc HTML and stuff each block into the right slot
 *  on the bound template. Returns the new field_values plus any blocks
 *  that didn't find a home. */
export function docHtmlToFieldValues(
  docHtml: string,
  template: WebContentTemplate,
  /** Existing values for group items (cards, etc.) we don't touch here
   *  — they're edited via the form-style group rows below the editor. */
  existingGroupValues: Record<string, unknown> = {},
): DocToFieldsResult {
  if (typeof window === 'undefined') {
    return { field_values: existingGroupValues, unmapped: [] }
  }
  const doc = new DOMParser().parseFromString(`<div>${docHtml}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return { field_values: existingGroupValues, unmapped: [] }

  const out: Record<string, unknown> = { ...existingGroupValues }
  const unmapped: DocToFieldsResult['unmapped'] = []

  // Buckets harvested from the doc.
  let taglineText = ''
  const headingsByLevel = new Map<number, string>()
  const bodyParts: string[] = []
  const ctas: Array<{ label: string; url: string }> = []
  const images: string[] = []
  const cardGrids: Element[] = []

  for (const el of Array.from(root.children)) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'div' && el.hasAttribute('data-bx-tagline')) {
      taglineText = (el.textContent ?? '').trim()
    } else if (tag === 'div' && el.hasAttribute('data-bx-cta')) {
      ctas.push({
        label: el.getAttribute('data-label') ?? '',
        url: el.getAttribute('data-url') ?? '',
      })
    } else if (tag === 'div' && el.hasAttribute('data-bx-image')) {
      const src = el.getAttribute('data-src') ?? ''
      if (src) images.push(src)
    } else if (tag === 'div' && el.hasAttribute('data-bx-card-grid')) {
      cardGrids.push(el)
    } else if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1))
      headingsByLevel.set(level, (el.textContent ?? '').trim())
    } else if (tag === 'p' || tag === 'ul' || tag === 'ol') {
      bodyParts.push(el.outerHTML)
    }
  }

  // Route into template slots.

  // Tagline.
  for (const f of template.fields) {
    if (f.kind === 'slot' && isTaglineSlot(f)) {
      out[f.key] = taglineText
      break
    }
  }

  // Heading(s). Prefer matching by heading_level when the slot is
  // explicit; otherwise take H1 → first heading-shaped slot, H2 → next.
  const headingSlots = template.fields
    .filter((f): f is WebSlotDef =>
      f.kind === 'slot' && isHeadingSlot(f) && !isTaglineSlot(f)
    )
  const usedHeadingSlots = new Set<string>()
  // First pass — exact level match.
  for (const slot of headingSlots) {
    if (slot.heading_level) {
      const t = headingsByLevel.get(slot.heading_level)
      if (t != null) {
        out[slot.key] = t
        usedHeadingSlots.add(slot.key)
      }
    }
  }
  // Second pass — fill any remaining heading slots in heading order.
  const remainingHeadings = [...headingsByLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([level]) =>
      !headingSlots.some(s => s.heading_level === level && usedHeadingSlots.has(s.key))
    )
    .map(([, text]) => text)
  for (const slot of headingSlots) {
    if (usedHeadingSlots.has(slot.key)) continue
    const next = remainingHeadings.shift()
    if (next != null) {
      out[slot.key] = next
      usedHeadingSlots.add(slot.key)
    }
  }

  // Body (joined HTML into the first richtext-shaped slot).
  const bodyHtml = bodyParts.join('')
  for (const f of template.fields) {
    if (f.kind === 'slot' && isBodySlot(f)) {
      out[f.key] = bodyHtml
      break
    }
  }

  // CTAs.
  const ctaQueue = [...ctas]
  for (const f of template.fields) {
    if (ctaQueue.length === 0) break
    if (f.kind === 'slot' && isCtaSlot(f)) {
      out[f.key] = ctaQueue.shift()
    } else if (f.kind === 'group' && isCtaGroup(f)) {
      const itemSchema = f.item_schema
      const items: Record<string, unknown>[] = []
      while (ctaQueue.length > 0) {
        const cta = ctaQueue.shift()!
        const item: Record<string, unknown> = {}
        // Match against the item's schema — cta slot first, else
        // button-label text slot.
        const ctaSlot = itemSchema.find((s): s is WebSlotDef =>
          s.kind === 'slot' && isCtaSlot(s)
        )
        if (ctaSlot) {
          item[ctaSlot.key] = cta
        } else {
          const labelSlot = itemSchema.find((s): s is WebSlotDef =>
            s.kind === 'slot' && isButtonLabelSlot(s)
          )
          if (labelSlot) {
            item[labelSlot.key] = cta.label
            if (cta.url) item.__cta_url = cta.url
          }
        }
        items.push(item)
      }
      out[f.key] = items
    }
  }

  // Any unmapped CTAs.
  for (const cta of ctaQueue) unmapped.push({ kind: 'cta', ...cta })

  // Images — write the first image to the template's first image slot.
  if (images.length > 0) {
    for (const f of template.fields) {
      if (f.kind === 'slot' && isImageSlot(f)) {
        out[f.key] = images[0]
        break
      }
    }
  }

  // Card grids — first grid in the doc maps to the template's first
  // card-shaped group. Walk each card's children, extract heading /
  // paragraphs / cta, stuff them into the corresponding item-schema slots.
  if (cardGrids.length > 0) {
    const grid = cardGrids[0]
    const cardEls = Array.from(grid.children).filter(c =>
      c.tagName.toLowerCase() === 'div' && c.hasAttribute('data-bx-card')
    )
    const targetGroup = template.fields.find((f): f is WebGroupDef =>
      f.kind === 'group' && isCardShapedGroup(f)
    )
    if (targetGroup) {
      const headingKey = findCardHeadingKey(targetGroup.item_schema as never)
      const bodyKey = findCardBodyKey(targetGroup.item_schema as never)
      const ctaKey = findCardCtaKey(targetGroup.item_schema as never)
      const items: Record<string, unknown>[] = cardEls.map(card => {
        const item: Record<string, unknown> = {}
        const inner: string[] = []
        let headingText = ''
        let cardCta: { label: string; url: string } | null = null
        for (const child of Array.from(card.children)) {
          const t = child.tagName.toLowerCase()
          if (/^h[1-6]$/.test(t) && !headingText) {
            headingText = (child.textContent ?? '').trim()
          } else if (t === 'div' && child.hasAttribute('data-bx-cta') && !cardCta) {
            cardCta = {
              label: child.getAttribute('data-label') ?? '',
              url: child.getAttribute('data-url') ?? '',
            }
          } else if (t === 'p' || t === 'ul' || t === 'ol') {
            inner.push(child.outerHTML)
          }
        }
        if (headingKey && headingText) item[headingKey] = headingText
        if (bodyKey && inner.length > 0) item[bodyKey] = inner.join('')
        if (ctaKey && cardCta) {
          // If the card's cta slot is type='cta', store the full object;
          // if it's a button-label text slot, store just the label.
          const ctaSlot = targetGroup.item_schema.find(s => s.kind === 'slot' && s.key === ctaKey) as WebSlotDef | undefined
          if (ctaSlot?.type === 'cta') {
            item[ctaKey] = cardCta
          } else {
            item[ctaKey] = cardCta.label
            if (cardCta.url) item.__cta_url = cardCta.url
          }
        }
        return item
      })
      out[targetGroup.key] = items
    }
  }

  return { field_values: out, unmapped }
}

/** Value-shape doc emitter. Builds a Brixies doc HTML directly from a
 *  raw `field_values` blob without needing a source template — used
 *  when the copywriter shipped concept-style template_ids that don't
 *  resolve in the catalog, so we have nothing to round-trip from.
 *
 *  Routing is by KEY SHAPE not template schema:
 *    · keys with "tagline" / "eyebrow" / "kicker"     → <div data-bx-tagline>
 *    · keys with "heading" / "headline" / "title"     → <h1>
 *    · keys with "body" / "description" / "content"   → <p> (or pass-through HTML)
 *    · keys with "button" / "cta" + array/items shape → <div data-bx-cta>
 *    · keys with "card" / "feature" / "step" / "team"
 *      / "tile" / "grid" + array/items shape           → <div data-bx-card-grid>
 *
 *  The resulting doc HTML is then re-parsed against the NEW template
 *  via `docHtmlToFieldValues`, so content lands in whatever slots the
 *  new template provides. */
export function valuesToDocHtmlByShape(values: Record<string, unknown>): string {
  const parts: string[] = []
  const used = new Set<string>()

  const isHeadingKey = (k: string): boolean => {
    const c = canonical(k)
    return c === 'h' || c === 'h1' || c === 'h2' || c === 'h3'
      || c.includes('heading') || c.includes('headline') || c.includes('title')
  }
  const isTaglineKey = (k: string): boolean => {
    const c = canonical(k)
    return c.includes('tagline') || c.includes('eyebrow') || c.includes('kicker')
      || c.includes('subheading') || c === 'subline' || c === 'pretitle'
  }
  const isBodyKey = (k: string): boolean => {
    const c = canonical(k)
    return c === 'd' || c.includes('body') || c.includes('description')
      || c.includes('content') || c.includes('intro') || c.includes('paragraph')
  }
  const isButtonsKey = (k: string): boolean => {
    const c = canonical(k)
    return c === 'buttons' || c === 'cta' || c === 'ctas' || c === 'actions'
      || c.includes('button')
  }
  const isCardGroupKey = (k: string): boolean => {
    const c = canonical(k)
    if (isButtonsKey(k)) return false
    return c.includes('card') || c === 'items' || c.includes('feature')
      || c.includes('step') || c.includes('tile') || c.includes('member')
      || c.includes('team') || c.includes('grid') || c === 'tiers'
      || c === 'programs' || c === 'classes' || c === 'events'
      || c === 'pillars' || c === 'values' || c === 'doctrines'
  }

  const unwrapItems = (v: unknown): unknown[] => {
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object' && 'items' in (v as Record<string, unknown>)) {
      const items = (v as { items?: unknown }).items
      if (Array.isArray(items)) return items
    }
    // Single CTA-shape `{label, url}` (or `{contact, url}`) — treat as
    // a one-item list so the copywriter's shorthand for a single
    // primary button doesn't get dropped.
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      const hasLabel = typeof o.label === 'string' || typeof o.text === 'string'
        || typeof o.title === 'string' || typeof o.contact === 'string'
        || typeof o.cta_label === 'string'
      const hasUrl   = typeof o.url === 'string' || typeof o.href === 'string'
      if (hasLabel || hasUrl) return [v]
    }
    return []
  }

  const extractCtaLabel = (obj: Record<string, unknown>): string => {
    if (typeof obj.label === 'string')     return obj.label
    if (typeof obj.text === 'string')      return obj.text
    if (typeof obj.title === 'string')     return obj.title
    if (typeof obj.cta_label === 'string') return obj.cta_label
    // Copywriter convention sometimes ships the visible label under
    // `contact` (e.g. "Plan Your Visit"). Treat it as the label.
    if (typeof obj.contact === 'string')   return obj.contact
    return ''
  }
  const extractCtaUrl = (obj: Record<string, unknown>): string => {
    if (typeof obj.url === 'string')  return obj.url
    if (typeof obj.href === 'string') return obj.href
    return ''
  }

  // 1. Tagline (more specific than heading — check first).
  for (const [k, v] of Object.entries(values)) {
    if (used.has(k)) continue
    if (isTaglineKey(k) && typeof v === 'string' && v.trim() !== '') {
      parts.push(`<div data-bx-tagline data-bx-label="TAGLINE" data-bx-kind="tagline" class="brixies-tagline">${escapeHtml(v)}</div>`)
      used.add(k)
    }
  }
  // 2. Heading(s).
  for (const [k, v] of Object.entries(values)) {
    if (used.has(k)) continue
    if (isHeadingKey(k) && typeof v === 'string' && v.trim() !== '') {
      parts.push(`<h1>${escapeHtml(v)}</h1>`)
      used.add(k)
    }
  }
  // 3. Body — pass through HTML when it looks like markup, else wrap in <p>.
  for (const [k, v] of Object.entries(values)) {
    if (used.has(k)) continue
    if (isBodyKey(k) && typeof v === 'string' && v.trim() !== '') {
      if (/<[a-z][^>]*>/i.test(v)) parts.push(v)
      else parts.push(`<p>${escapeHtml(v)}</p>`)
      used.add(k)
    }
  }
  // 4. Buttons / CTAs.
  for (const [k, v] of Object.entries(values)) {
    if (used.has(k)) continue
    if (!isButtonsKey(k)) continue
    const items = unwrapItems(v)
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      const label = extractCtaLabel(obj)
      const url   = extractCtaUrl(obj)
      if (label || url) parts.push(renderCtaNode(label, url))
    }
    used.add(k)
  }
  // 5. Card-shaped group — first one wins (matches the round-trip's
  //    single-card-grid contract).
  for (const [k, v] of Object.entries(values)) {
    if (used.has(k)) continue
    if (!isCardGroupKey(k)) continue
    const items = unwrapItems(v)
    if (items.length === 0) continue
    const cardHtml = items.map(item => {
      if (!item || typeof item !== 'object') return ''
      const obj = item as Record<string, unknown>
      const inner: string[] = []
      // Heading inside the card.
      for (const [ik, iv] of Object.entries(obj)) {
        if (isHeadingKey(ik) && typeof iv === 'string' && iv.trim() !== '') {
          inner.push(`<h3>${escapeHtml(iv)}</h3>`)
          break
        }
      }
      // Body inside the card.
      for (const [ik, iv] of Object.entries(obj)) {
        if (isBodyKey(ik) && typeof iv === 'string' && iv.trim() !== '') {
          if (/<[a-z][^>]*>/i.test(iv)) inner.push(iv)
          else inner.push(`<p>${escapeHtml(iv)}</p>`)
          break
        }
      }
      // Card-level CTA: look for any URL the card item carries —
      // either at the top of the item, or nested under common button
      // keys (buttons_card / buttons / cta) since the copywriter
      // sometimes wraps the CTA in an object instead of flattening
      // its url onto the card item itself.
      let cardLabel = ''
      let cardUrl   = ''
      const topUrl = extractCtaUrl(obj)
      if (topUrl) {
        cardUrl = topUrl
        cardLabel = extractCtaLabel(obj)
      } else {
        for (const nestedKey of ['buttons_card', 'buttons', 'cta', 'ctas', 'cta_card']) {
          const nested = obj[nestedKey]
          if (!nested) continue
          // Nested might be a single {label, url} or {items: [...]}.
          const nestedItems = unwrapItems(nested)
          if (nestedItems.length > 0) {
            const first = nestedItems[0] as Record<string, unknown>
            cardUrl   = extractCtaUrl(first)
            cardLabel = extractCtaLabel(first)
            if (cardUrl || cardLabel) break
          }
        }
      }
      if (cardUrl || cardLabel) {
        inner.push(renderCtaNode(cardLabel || 'Learn more', cardUrl))
      }
      if (inner.length === 0) inner.push('<p></p>')
      return `<div data-bx-card data-bx-label="CARD" data-bx-kind="group" class="brixies-card">${inner.join('')}</div>`
    }).filter(Boolean).join('')
    if (cardHtml) {
      parts.push(`<div data-bx-card-grid data-bx-label="CARD GRID" data-bx-kind="group" class="brixies-card-grid">${cardHtml}</div>`)
      used.add(k)
      break
    }
  }

  return parts.join('') || '<p></p>'
}

/** Merge two field_values maps for the same template, preferring non-
 *  empty values from `primary` and filling holes from `secondary`. Used
 *  by the importer to combine a schema-direct normalize (Phase 1) with
 *  the value-shape doc route (Phase 2) — Phase 1 wins for every slot
 *  whose key matched the source verbatim, Phase 2 fills only where
 *  Phase 1 came back empty. */
export function mergeFieldValuesPreferNonEmpty(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
  template: WebContentTemplate,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...primary }
  const isEmpty = (v: unknown): boolean => {
    if (v === undefined || v === null) return true
    if (typeof v === 'string') return v.trim() === ''
    if (Array.isArray(v)) return v.length === 0
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      if ('label' in o || 'url' in o) return !o.label && !o.url
      if ('items' in o) {
        const items = (o as { items?: unknown }).items
        return !Array.isArray(items) || items.length === 0
      }
      return Object.keys(o).length === 0
    }
    return false
  }
  for (const f of template.fields) {
    const primaryVal = out[f.key]
    if (!isEmpty(primaryVal)) continue
    const secondaryVal = secondary[f.key]
    if (!isEmpty(secondaryVal)) out[f.key] = secondaryVal
  }
  // Also carry forward any non-template keys from secondary (e.g.
  // reserved __* stashes) when primary doesn't have them.
  for (const [k, v] of Object.entries(secondary)) {
    if (k in out) continue
    out[k] = v
  }
  return out
}

/** Reserved keys that live alongside slot/group values on `field_values`
 *  but aren't user-editable content — they're internal stashes the editor
 *  uses for overflow, bind reports, unmapped imports, etc. */
export const RESERVED_FIELD_KEYS = new Set([
  '__overflow_html', '__bind_report', '__unmapped',
  '__extra_ctas', '__extra_cards',
])

/** Walk every leaf (string/number/boolean) inside an arbitrarily-nested
 *  value, invoking `visit(path, value)` with a JSON-pointer-ish path.
 *  Arrays become `[i]` segments; object children become `.key`. */
function walkLeaves(
  node: unknown,
  path: string,
  visit: (path: string, value: unknown) => void,
): void {
  if (node == null) return
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    visit(path, node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkLeaves(item, `${path}[${i}]`, visit))
    return
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const next = path ? `${path}.${k}` : k
      walkLeaves(v, next, visit)
    }
  }
}

/** Collect every non-empty leaf string anywhere in `node`. Used by
 *  computeDroppedDeepPaths to test whether a source leaf survived the
 *  swap (under any key, at any depth). Lowercased + trimmed to make
 *  the substring representation check forgiving of trivial casing. */
function collectLeafStrings(node: unknown): Set<string> {
  const out = new Set<string>()
  walkLeaves(node, '', (_p, v) => {
    if (typeof v === 'string' && v.trim() !== '') out.add(v.trim())
  })
  return out
}

/** Deep "what would drop on swap?" check. Walks every leaf in `source`
 *  and verifies that the leaf's value is represented somewhere in
 *  `mapped` — either as an exact match or as a substring of (or
 *  containing) a mapped leaf, so the doc round-trip's `<p>…</p>`
 *  wrapping doesn't count as a drop.
 *
 *  Unlike `computeUnmappedValues` (which is keyed by top-level slot
 *  names and used to populate the `__unmapped` stash), this walks
 *  recursively into group items so a CTA hidden inside `card[0]
 *  .buttons_card` doesn't silently disappear when the new template's
 *  card item_schema has no `buttons_card` slot.
 *
 *  Returns dotted/bracketed paths into `source` where content didn't
 *  make it across, deduped by tail key so the variant-swap dialog
 *  can show concise items ("card.buttons_card" once instead of
 *  "card[0].buttons_card", "card[1].buttons_card", …). */
export function computeDroppedDeepPaths(
  source: Record<string, unknown>,
  mapped: Record<string, unknown>,
): string[] {
  const mappedLeaves = collectLeafStrings(mapped)
  const lowerMapped = new Set<string>()
  for (const m of mappedLeaves) lowerMapped.add(m.toLowerCase())

  const droppedPaths: string[] = []
  walkLeaves(source, '', (path, val) => {
    if (typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') return
    const s = String(val).trim()
    if (!s) return
    // Skip reserved-key subtrees entirely — they're internal state.
    const firstKey = path.split(/[.[]/)[0]
    if (RESERVED_FIELD_KEYS.has(firstKey)) return
    // Skip numeric-only leaves (sort_orders, year_card="1991", etc.)
    // — they're not content losses if they don't carry through.
    if (typeof val === 'number') return
    const lower = s.toLowerCase()
    if (lowerMapped.has(lower)) return
    // Substring representation — `<p>foo</p>` in mapped should cover
    // raw `foo` in source.
    let represented = false
    for (const m of lowerMapped) {
      if (m.includes(lower) || lower.includes(m)) { represented = true; break }
    }
    if (represented) return
    droppedPaths.push(path)
  })

  // Dedupe by "tail key" so we report `card.buttons_card` once instead
  // of one entry per item index. The tail key is the path with all
  // numeric `[N]` segments stripped — `card[0].buttons_card` and
  // `card[3].buttons_card` collapse to `card.buttons_card`.
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of droppedPaths) {
    const key = p.replace(/\[\d+\]/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

const isLikelyEmptyValue = (v: unknown): boolean => {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('label' in o || 'url' in o) {
      return !o.label && !o.url
    }
    if ('items' in o) {
      const items = (o as { items?: unknown }).items
      return !Array.isArray(items) || items.length === 0
    }
    return Object.keys(o).length === 0
  }
  return false
}

/** Compute the subset of `rawValues` that didn't make it into a slot or
 *  group on the bound template. Used to stash content so swapping the
 *  template later can rehydrate it into matching slots.
 *
 *  A raw key is "unmapped" when:
 *    · its value is non-empty, AND
 *    · the template has no field whose canonical key matches (OR the
 *      matching field is empty in `mappedValues` AND the raw value
 *      isn't visibly represented in any other mapped value).
 *
 *  Reserved internal keys (`__overflow_html`, etc.) are never unmapped. */
export function computeUnmappedValues(
  rawValues: Record<string, unknown>,
  mappedValues: Record<string, unknown>,
  template: WebContentTemplate | null,
): Record<string, unknown> {
  if (!template) {
    // No template bound — stash the lot so a future bind can use it.
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rawValues)) {
      if (RESERVED_FIELD_KEYS.has(k)) continue
      if (isLikelyEmptyValue(v)) continue
      out[k] = v
    }
    return out
  }

  const fieldKeyByCanonical = new Map<string, string>()
  for (const f of template.fields) {
    fieldKeyByCanonical.set(canonical(f.key), f.key)
  }

  // Pre-compute the set of mapped string values + group lengths, so we
  // can spot rawValues that got routed via the value-shape doc emit
  // (e.g., raw `subtitle` → mapped `tagline`).
  const mappedStrings = new Set<string>()
  const mappedItemCounts = new Set<number>()
  for (const mv of Object.values(mappedValues)) {
    if (typeof mv === 'string' && mv.trim() !== '') {
      mappedStrings.add(mv.trim())
    } else if (Array.isArray(mv) && mv.length > 0) {
      mappedItemCounts.add(mv.length)
    }
  }

  const valueIsRepresented = (rv: unknown): boolean => {
    if (typeof rv === 'string') {
      const trimmed = rv.trim()
      if (!trimmed) return false
      if (mappedStrings.has(trimmed)) return true
      // Partial match — handles cases where the doc emit wrapped <p>…</p>
      // around the raw body.
      for (const ms of mappedStrings) {
        if (ms.includes(trimmed) || trimmed.includes(ms)) return true
      }
      return false
    }
    if (Array.isArray(rv) && rv.length > 0) {
      return mappedItemCounts.has(rv.length)
    }
    if (rv && typeof rv === 'object' && 'items' in (rv as Record<string, unknown>)) {
      const items = (rv as { items?: unknown }).items
      if (Array.isArray(items) && items.length > 0) {
        return mappedItemCounts.has(items.length)
      }
    }
    return false
  }

  const out: Record<string, unknown> = {}
  for (const [rk, rv] of Object.entries(rawValues)) {
    if (RESERVED_FIELD_KEYS.has(rk)) continue
    if (isLikelyEmptyValue(rv)) continue

    const targetFieldKey = fieldKeyByCanonical.get(canonical(rk))
    if (targetFieldKey && !isLikelyEmptyValue(mappedValues[targetFieldKey])) continue

    if (valueIsRepresented(rv)) continue

    out[rk] = rv
  }
  return out
}

/** Backstop for cross-family template swaps. The doc round-trip captures
 *  the canonical Brixies block shapes (tagline / headings / body / first
 *  card group / first image / CTAs) but ignores anything else — services
 *  arrays, faqs, accordions, stats, link columns, second image slots,
 *  multiple non-card groups, etc. — and `normalizeFieldValuesForTemplate`
 *  on the import side drops keys not present in the OLD template entirely.
 *
 *  This helper takes the round-trip result and fills any NEW-template
 *  slot or group that's still empty by matching canonical keys against
 *  the original `oldValues`. So `services` → `services`, `service_times`
 *  → `serviceTimes`, `body_richtext` → `bodyRichtext` carry copy through
 *  by name even when the structural pass missed them. */
/** Optional sink the caller can pass to observe which fallback layers
 *  actually fired during reconcile. Used by bind telemetry so we can
 *  see in aggregate which templates rely on shape-align / FAQ-alias to
 *  bind cleanly. Mutated in place. */
export interface ReconcileTelemetry {
  used_shape_align: boolean
  used_faq_alias:   boolean
  shape_align_target_keys: string[]   // template group keys that got filled via shape align
}

export function reconcileFieldValuesAcrossTemplates(
  oldValues: Record<string, unknown>,
  newTpl: WebContentTemplate,
  roundTripResult: Record<string, unknown>,
  /** Optional lookup so palette-referenced groups (item_template_ref =
   *  "from_palette") can resolve their effective item_schema from the
   *  referenced card/component template. Without this the shape-align
   *  pass below can't see palette item keys (e.g. `heading_card`,
   *  `description_card`) and can't re-key source items into them. */
  paletteTemplates?: Record<string, WebContentTemplate>,
  telemetry?: ReconcileTelemetry,
): Record<string, unknown> {
  const out = { ...roundTripResult }

  // Build a canonical-key index of every old value, including the raw
  // shape (string, array, object, {items:[...]}, etc.).
  const oldByCanonical = new Map<string, unknown>()
  for (const [k, v] of Object.entries(oldValues)) {
    if (v === undefined || v === null) continue
    oldByCanonical.set(canonical(k), v)
  }

  const isEmpty = (v: unknown): boolean => {
    if (v === undefined || v === null) return true
    if (typeof v === 'string') return v.trim() === ''
    if (Array.isArray(v)) return v.length === 0
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      // Empty CTA-shape: { label: '', url: '' }
      if ('label' in o || 'url' in o) {
        return !o.label && !o.url
      }
      return Object.keys(o).length === 0
    }
    return false
  }

  // Semantic-alias matcher. When the template-key canonical doesn't
  // match a source-key canonical exactly, we still want to recognize
  // common content shapes. Today: FAQ items can ship under
  // `faq_items` / `faqs` / `questions` / `accordion` etc. but the
  // bound template's group is often named whatever the source_html
  // container was called (e.g. `accordion`, `faq_list`, sometimes
  // augmenter-derived names that don't match either source convention).
  // We side-channel-match a template GROUP whose item_schema looks
  // FAQ-shaped (carries `question`+`answer` slots, canonical) against
  // a set of source-key aliases the copywriter would naturally use.
  const FAQ_SOURCE_ALIASES = new Set([
    'faqitems', 'faqs', 'faq', 'questions', 'accordionitems', 'accordion',
  ])
  const isFaqShapedGroup = (group: WebGroupDef): boolean => {
    if (!Array.isArray(group.item_schema)) return false
    let sawQ = false
    let sawA = false
    for (const inner of group.item_schema) {
      if (inner.kind !== 'slot') continue
      const c = canonical(inner.key)
      const layer = inner.layer_name ? canonical(inner.layer_name) : ''
      if (c.includes('question') || layer.includes('question')) sawQ = true
      if (c.includes('answer')   || layer.includes('answer'))   sawA = true
    }
    return sawQ && sawA
  }
  const findFaqAliasInSource = (): unknown => {
    for (const [k, v] of Object.entries(oldValues)) {
      if (FAQ_SOURCE_ALIASES.has(canonical(k))) return v
    }
    return undefined
  }

  for (const f of newTpl.fields) {
    if (f.kind === 'slot') {
      if (!isEmpty(out[f.key])) continue
      const match = oldByCanonical.get(canonical(f.key))
      if (match !== undefined && !isEmpty(match)) {
        out[f.key] = match
      }
      continue
    }
    if (f.kind === 'group') {
      const current = out[f.key]
      if (Array.isArray(current) && current.length > 0) continue
      let match = oldByCanonical.get(canonical(f.key))
      // FAQ alias fallback — the source key might not canonical-match
      // this group's key but its shape (question+answer item_schema)
      // tells us the copywriter's `faq_items` belongs here.
      if (match === undefined && isFaqShapedGroup(f)) {
        const aliased = findFaqAliasInSource()
        if (aliased !== undefined) {
          match = aliased
          if (telemetry) telemetry.used_faq_alias = true
        }
      }
      if (Array.isArray(match) && match.length > 0) {
        out[f.key] = match
      } else if (
        match && typeof match === 'object' && !Array.isArray(match)
        && 'items' in (match as Record<string, unknown>)
      ) {
        const items = (match as { items?: unknown }).items
        if (Array.isArray(items) && items.length > 0) out[f.key] = items
      }
    }
  }

  // ── Compatible-shape group fill ─────────────────────────────────────
  // Final pass: for any target group still empty, scan oldValues for an
  // array of objects whose item shape can be aligned to this group's
  // resolved item_schema. The matcher pairs source item keys to target
  // slot keys by canonical equality first, then by canonical substring
  // overlap (so `heading` → `heading_card`, `description` →
  // `description_card`, `buttons_card` ↔ `button` etc.).
  //
  // This is what lets `container_left.items: [{heading, description}]`
  // (copywriter shape) flow into feature-section-2's palette-card group
  // whose effective item_schema (resolved through paletteTemplates)
  // is `[{heading_card}, {description_card}, ...]`. It's the binder
  // becoming flexible about the gap between cowork's content-shaped
  // copy and Brixies's layer-shaped schemas — neither side needs to
  // know the other's key conventions.
  for (const f of newTpl.fields) {
    if (f.kind !== 'group') continue
    const current = out[f.key]
    if (Array.isArray(current) && current.length > 0) continue

    const targetItemSchema = resolveEffectiveItemSchema(f, paletteTemplates)
    if (targetItemSchema.length === 0) continue

    // Find the best source array — at least one item slot must be
    // matchable, and we prefer the candidate with the most matches.
    let bestSource: Array<Record<string, unknown>> | null = null
    let bestMatches = 0
    for (const [srcKey, srcVal] of Object.entries(oldValues)) {
      if (RESERVED_FIELD_KEYS.has(srcKey)) continue
      if (srcKey === f.key) continue  // exact-key already tried above
      const arr = unwrapToObjectArray(srcVal)
      if (!arr || arr.length === 0) continue
      const sample = arr[0]
      const matched = targetItemSchema.reduce((n, slot) =>
        n + (slot.kind === 'slot' && matchSourceKeyForSlot(slot, sample) ? 1 : 0),
      0)
      if (matched > bestMatches) {
        bestMatches = matched
        bestSource = arr
      }
    }
    if (bestSource && bestMatches > 0) {
      out[f.key] = alignItemsToSchema(bestSource, targetItemSchema)
      if (telemetry) {
        telemetry.used_shape_align = true
        telemetry.shape_align_target_keys.push(f.key)
      }
    }
  }

  return out
}

/** Return a group's effective item_schema, following palette refs
 *  through `paletteTemplates` if provided. Falls back to the group's
 *  own `item_schema` when no palette ref or no lookup is available. */
function resolveEffectiveItemSchema(
  group: WebGroupDef,
  paletteTemplates?: Record<string, WebContentTemplate>,
): WebFieldDef[] {
  if (group.item_template_ref && group.referenced_template_id && paletteTemplates) {
    const ref = paletteTemplates[group.referenced_template_id]
    if (ref && Array.isArray(ref.fields)) return ref.fields
  }
  return Array.isArray(group.item_schema) ? group.item_schema : []
}

/** Unwrap a value into `Array<Record<string, unknown>>` if it looks
 *  like one — handles raw arrays AND `{items: [...]}` wrapper. Filters
 *  out non-object entries. Returns null when the value isn't an array
 *  of objects. */
function unwrapToObjectArray(v: unknown): Array<Record<string, unknown>> | null {
  let arr: unknown[] | null = null
  if (Array.isArray(v)) {
    arr = v
  } else if (v && typeof v === 'object' && 'items' in (v as Record<string, unknown>)) {
    const items = (v as { items?: unknown }).items
    if (Array.isArray(items)) arr = items
  }
  if (!arr) return null
  const objs = arr.filter(it => it && typeof it === 'object' && !Array.isArray(it)) as Array<Record<string, unknown>>
  return objs.length > 0 ? objs : null
}

/** Pair a target slot to a source-item key. Prefers exact-canonical
 *  matches, falls back to canonical substring overlap. Used to align
 *  source items shaped one way (cowork's `heading` / `description`)
 *  to target item slots shaped another (palette card's `heading_card`
 *  / `description_card`). Min canonical length of 4 keeps `id`/`url`
 *  from matching everything that happens to contain those letters. */
function matchSourceKeyForSlot(
  slot: WebFieldDef,
  sourceItem: Record<string, unknown>,
): string | undefined {
  if (slot.kind !== 'slot') return undefined
  const targetCanonical = canonical(slot.key)
  const layerCanonical = slot.layer_name ? canonical(slot.layer_name) : ''
  // Pass 1: exact canonical match (preferred).
  for (const srcKey of Object.keys(sourceItem)) {
    const srcCanonical = canonical(srcKey)
    if (srcCanonical === targetCanonical) return srcKey
    if (layerCanonical && srcCanonical === layerCanonical) return srcKey
  }
  // Pass 2: substring overlap — `heading` ⊂ `heading_card`,
  // `description` ⊂ `description_card`, etc. Require min length so
  // short keys (`id`, `url`) don't false-match.
  for (const srcKey of Object.keys(sourceItem)) {
    const srcCanonical = canonical(srcKey)
    if (srcCanonical.length < 4 || targetCanonical.length < 4) continue
    if (targetCanonical.includes(srcCanonical)) return srcKey
    if (srcCanonical.includes(targetCanonical)) return srcKey
  }
  return undefined
}

/** Build a new array of items keyed against `targetItemSchema`. Each
 *  target slot pulls from a matched source key (or stays absent so
 *  the slot renders blank). Nested group fields in `targetItemSchema`
 *  are passed through if the source item has a matching array. */
function alignItemsToSchema(
  source: Array<Record<string, unknown>>,
  targetItemSchema: WebFieldDef[],
): Array<Record<string, unknown>> {
  return source.map(item => {
    const out: Record<string, unknown> = {}
    for (const f of targetItemSchema) {
      if (f.kind === 'slot') {
        const srcKey = matchSourceKeyForSlot(f, item)
        if (srcKey !== undefined) out[f.key] = item[srcKey]
      } else if (f.kind === 'group') {
        // Nested-group passthrough — find a source key whose value is
        // an array, route it (no recursion for now — most copywriter
        // shapes stop at one level of nesting).
        for (const srcKey of Object.keys(item)) {
          if (canonical(srcKey) === canonical(f.key)) {
            const arr = unwrapToObjectArray(item[srcKey])
            if (arr) { out[f.key] = arr; break }
          }
        }
      }
    }
    return out
  })
}
