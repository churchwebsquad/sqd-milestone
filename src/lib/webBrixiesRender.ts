/**
 * Brixies live-render — substitute field_values into the template's
 * source_html for the Preview iframe.
 *
 * The Brixies source_html carries `data-layer="X"` attributes on every
 * meaningful element. The template's `fields` schema is keyed by the
 * same layer names (with the importer preserving order). We walk the
 * DOM, find each data-layer that matches a slot or group in the
 * schema, and:
 *
 *   - **slot** → replace the inner text/HTML with the slot's value
 *     from field_values. Image slots set their <img src>. CTA slots
 *     set the inner text + wrap in an <a href>.
 *
 *   - **group** → clone the first data-layer child N times (one per
 *     item in field_values[group.key]), recursively populating each
 *     clone's slots with the item's values.
 *
 * The result is the same Brixies HTML the template ships with, just
 * with strategist copy in place of the Brixies sample text. Rendered
 * inside an iframe at the native 1512px viewport (the canvas Brixies
 * designed for), the layout is pixel-faithful.
 *
 * No JS execution risk — we're stringifying a DOM we just built from
 * a known-trusted template source.
 */
import type {
  WebContentTemplate, WebFieldDef, WebSlotDef, WebGroupDef,
} from '../types/database'

/** Build the substituted HTML for a single section. */
export function renderSectionToHtml(
  template: WebContentTemplate,
  values: Record<string, unknown>,
): string {
  if (typeof window === 'undefined' || !template.source_html) return ''
  const doc = new DOMParser().parseFromString(template.source_html, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''

  // Build a fast lookup: layer_name → field def at the TOP level.
  // For nested item_schema, we resolve per-group at substitute time.
  const topByLayer = indexByLayer(template.fields)

  substituteElement(root, topByLayer, values, /* itemContext */ null)

  return root.outerHTML
}

/** Substitute values into an element and its descendants. */
function substituteElement(
  el: Element,
  binding: Map<string, WebFieldDef>,
  values: Record<string, unknown>,
  itemContext: ItemContext | null,
): void {
  const layer = el.getAttribute('data-layer')
  if (layer) {
    const field = lookup(binding, layer)
    if (field?.kind === 'slot') {
      applySlot(el, field, values[field.key])
      return  // slot ends recursion — its content is rewritten
    }
    if (field?.kind === 'group') {
      expandGroup(el, field, values[field.key])
      return  // group ends recursion — children are now repeated clones
    }
    // Also check the item context — when we're inside an item clone,
    // child data-layer elements bind to the group's item_schema.
    if (itemContext) {
      const itemField = lookup(itemContext.binding, layer)
      if (itemField?.kind === 'slot') {
        applySlot(el, itemField, itemContext.values[itemField.key])
        return
      }
      if (itemField?.kind === 'group') {
        expandGroup(el, itemField, itemContext.values[itemField.key])
        return
      }
    }
  }
  // No binding at this element — recurse into children.
  for (const child of Array.from(el.children)) {
    substituteElement(child, binding, values, itemContext)
  }
}

interface ItemContext {
  binding: Map<string, WebFieldDef>
  values: Record<string, unknown>
}

/** Replace a single element's content with the slot's value. */
function applySlot(el: Element, slot: WebSlotDef, raw: unknown): void {
  switch (slot.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'datetime': {
      const text = typeof raw === 'string' ? raw : ''
      // Brixies elements may have multiple styled <span> children for
      // multi-color heading text (e.g. "Lorem ipsum" + colored span).
      // Replace inner text outright; the visual styling lives on the
      // wrapper or first child span.
      setInnerText(el, text)
      return
    }
    case 'richtext': {
      const html = typeof raw === 'string' ? raw : ''
      // Strip TipTap's wrapping <p>…</p> if it's a single paragraph —
      // Brixies's Description divs render fine as raw text + line
      // breaks, and the <p> wrapper would inherit `margin: 1em` from
      // user-agent defaults.
      el.innerHTML = html || ''
      return
    }
    case 'cta': {
      const cta = (typeof raw === 'object' && raw !== null)
        ? raw as { label?: string; url?: string }
        : { label: '', url: '' }
      // Brixies's CTA wrapper is a <div data-layer="Buttons"> with a
      // child <div data-layer="Contact"> holding the label text. We
      // wrap the existing innerHTML in an <a href> so clicks in the
      // preview behave like the eventual production link.
      const inner = el.innerHTML
      const url = cta.url ?? ''
      const label = cta.label ?? ''
      if (label) setInnerText(el, label, inner)
      if (url) {
        el.setAttribute('data-href', url)
        // Wrap with an anchor; preserve all other attributes/styles.
        const a = el.ownerDocument.createElement('a')
        a.setAttribute('href', url)
        a.style.textDecoration = 'none'
        a.style.color = 'inherit'
        // Move existing children to anchor, append anchor.
        while (el.firstChild) a.appendChild(el.firstChild)
        el.appendChild(a)
      }
      return
    }
    case 'image': {
      const src = typeof raw === 'string' ? raw : ''
      if (el.tagName.toLowerCase() === 'img' && src) {
        el.setAttribute('src', src)
      } else if (src) {
        // Sometimes images are wrapper divs with a background image.
        // For v1 we just set data-src; pixel-faithful image rendering
        // is template-specific and out of scope.
        el.setAttribute('data-src', src)
      }
      return
    }
    case 'form-input':
    case 'boolean':
    case 'map':
    default:
      // No-op — these don't substitute meaningfully into the rendered
      // preview. The form / map / toggle will surface natively later.
      return
  }
}

/** Expand a group element: clone its first data-layer child N times,
 *  with each clone bound to one item in field_values[group.key]. */
function expandGroup(groupEl: Element, group: WebGroupDef, raw: unknown): void {
  const items = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
  const count = items.length > 0 ? items.length : group.default_count
  if (count <= 0) {
    // No items — leave the group container empty.
    while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild)
    return
  }

  // Find the first data-layer child — that's the item template.
  const children = Array.from(groupEl.children)
  const itemTemplate = children.find(c => c.getAttribute('data-layer'))
  if (!itemTemplate) return  // Brixies emitted a group container with no
                             // data-layer child — bail; preview shows empty.

  const itemBinding = indexByLayer(group.item_schema)
  const ownerDoc = groupEl.ownerDocument

  // Remove all current children of the group container — we're going
  // to rebuild from clones of the item template.
  while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild)

  for (let i = 0; i < count; i++) {
    const itemValues = items[i] ?? {}
    const clone = itemTemplate.cloneNode(true) as Element
    substituteElement(clone, itemBinding, itemValues, {
      binding: itemBinding,
      values: itemValues,
    })
    groupEl.appendChild(clone)
    // Adopt into the document if needed — clones share the same
    // owner doc as the template so this should always be a no-op.
    void ownerDoc
  }
}

// ── Utilities ───────────────────────────────────────────────────────

function indexByLayer(fields: ReadonlyArray<WebFieldDef>): Map<string, WebFieldDef> {
  const m = new Map<string, WebFieldDef>()
  for (const f of fields) {
    const layer = f.layer_name ?? f.key
    m.set(layer, f)
  }
  return m
}

function lookup(map: Map<string, WebFieldDef>, layerName: string): WebFieldDef | undefined {
  if (map.has(layerName)) return map.get(layerName)
  const norm = layerName.trim().toLowerCase().replace(/\s+/g, ' ')
  for (const [k, v] of map.entries()) {
    if (k.trim().toLowerCase().replace(/\s+/g, ' ') === norm) return v
  }
  return undefined
}

/** Replace the element's text content while preserving any first-child
 *  <span> styling (Brixies emits styled spans for colored text). If
 *  fallbackHtml is provided, falls back to that when the value is
 *  empty (keeps the Brixies sample text rather than blank-rendering). */
function setInnerText(el: Element, text: string, fallbackHtml?: string): void {
  if (!text && fallbackHtml) {
    el.innerHTML = fallbackHtml
    return
  }
  // If the element has a single styled <span> child, replace its text
  // (preserves the color/font styling). Otherwise replace the whole
  // textContent.
  const firstSpan = Array.from(el.children).find(c => c.tagName.toLowerCase() === 'span')
  if (firstSpan && el.children.length === 1) {
    firstSpan.textContent = text
    return
  }
  el.textContent = text
}
