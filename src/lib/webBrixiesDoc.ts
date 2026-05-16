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
        // Try cta-slot first, then button-label-text slot + paired url.
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

  // Anything else gets surfaced as a freehand-style note at the bottom
  // (image URLs, datetimes, etc. that the doc doesn't yet model).
  // Phase 2 brings these into the doc as proper nodes.

  return parts.join('') || '<p></p>'
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

  for (const el of Array.from(root.children)) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'div' && el.hasAttribute('data-bx-tagline')) {
      taglineText = (el.textContent ?? '').trim()
    } else if (tag === 'div' && el.hasAttribute('data-bx-cta')) {
      ctas.push({
        label: el.getAttribute('data-label') ?? '',
        url: el.getAttribute('data-url') ?? '',
      })
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

  return { field_values: out, unmapped }
}
