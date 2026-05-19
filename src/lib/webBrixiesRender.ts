/**
 * Brixies live-render — substitute field_values into the template's
 * source_html for the section iframes and the Preview pane.
 *
 *   - **slot** → replace the inner text/HTML with the slot's value.
 *     Image slots set <img src>. CTA slots (and text+button slots
 *     carrying a `{label, url}` shape) set the inner text and wrap
 *     in an <a href>.
 *
 *   - **group** → clone the first data-layer child N times (one per
 *     item in field_values[group.key]), recursively populating each
 *     clone's slots with the item's values.
 *
 *   - After substitution, all remaining `{{token}}` literals in text
 *     nodes are resolved against the project's snippet map. Tokens
 *     with no resolved value are left literal so the strategist can
 *     spot what's missing.
 *
 *   - Stray Brixies aspect-ratio text (e.g. "504 × 378") in unused
 *     image placeholders is stripped so the rendered iframe doesn't
 *     show the design tool's empty-state dimensions.
 */
import type {
  WebContentTemplate, WebFieldDef, WebSlotDef, WebGroupDef,
} from '../types/database'

export type SnippetMap = Readonly<Record<string, string>>

export function renderSectionToHtml(
  template: WebContentTemplate,
  values: Record<string, unknown>,
  snippetMap?: SnippetMap,
): string {
  if (typeof window === 'undefined' || !template.source_html) return ''
  const doc = new DOMParser().parseFromString(template.source_html, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''

  const topByLayer = indexByLayer(template.fields)
  substituteElement(root, topByLayer, values, /* itemContext */ null)

  if (snippetMap) resolveSnippetsInTree(root, snippetMap)
  stripAspectRatioText(root)

  return root.outerHTML
}

// ── Substitution ────────────────────────────────────────────────────

function substituteElement(
  el: Element,
  binding: Map<string, WebFieldDef>,
  values: Record<string, unknown>,
  itemContext: ItemContext | null,
): void {
  const layer = el.getAttribute('data-layer')
  if (layer) {
    const field = lookup(binding, layer)
    if (field?.kind === 'slot') { applySlot(el, field, values[field.key]); return }
    if (field?.kind === 'group') { expandGroup(el, field, values[field.key]); return }
    if (itemContext) {
      const itemField = lookup(itemContext.binding, layer)
      if (itemField?.kind === 'slot') { applySlot(el, itemField, itemContext.values[itemField.key]); return }
      if (itemField?.kind === 'group') { expandGroup(el, itemField, itemContext.values[itemField.key]); return }
    }
  }
  for (const child of Array.from(el.children)) {
    substituteElement(child, binding, values, itemContext)
  }
}

interface ItemContext {
  binding: Map<string, WebFieldDef>
  values: Record<string, unknown>
}

function applySlot(el: Element, slot: WebSlotDef, raw: unknown): void {
  // A text/url/email/phone slot can carry the unified button shape
  // `{label, url}` when it's a button-shaped slot. Render as a CTA.
  if ((slot.type === 'text' || slot.type === 'url' || slot.type === 'email' || slot.type === 'phone')
      && isCtaShape(raw)) {
    return applyCta(el, raw as { label?: string; url?: string })
  }
  switch (slot.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'datetime': {
      const text = typeof raw === 'string' ? raw : ''
      setInnerText(el, text)
      return
    }
    case 'richtext': {
      const html = typeof raw === 'string' ? raw : ''
      el.innerHTML = html || ''
      return
    }
    case 'cta': {
      return applyCta(el, isCtaShape(raw) ? raw as { label?: string; url?: string } : { label: '', url: '' })
    }
    case 'image': {
      applyImage(el, typeof raw === 'string' ? raw : '')
      return
    }
    default:
      return
  }
}

function isCtaShape(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null
    && ('label' in raw || 'url' in raw)
}

function applyCta(el: Element, cta: { label?: string; url?: string }): void {
  const inner = el.innerHTML
  const url = cta.url ?? ''
  const label = cta.label ?? ''
  if (label) setInnerText(el, label, inner)
  if (url) {
    el.setAttribute('data-href', url)
    const a = el.ownerDocument.createElement('a')
    a.setAttribute('href', url)
    a.style.textDecoration = 'none'
    a.style.color = 'inherit'
    while (el.firstChild) a.appendChild(el.firstChild)
    el.appendChild(a)
  }
}

function applyImage(el: Element, src: string): void {
  if (el.tagName.toLowerCase() === 'img') {
    if (src) el.setAttribute('src', src)
    return
  }
  if (src) el.setAttribute('data-src', src)
  // Clear the design-tool placeholder text (e.g. "504 × 378") so the
  // editor preview doesn't show artifact dimensions for empty slots.
  const placeholderText = (el.textContent ?? '').trim()
  if (!src && /^\d+\s*[×x]\s*\d+$/i.test(placeholderText)) {
    el.textContent = ''
  } else if (!src) {
    // The placeholder might wrap the dimension text in a span — clear
    // text nodes that match the pattern, leave structural children.
    stripAspectRatioText(el)
  }
}

function expandGroup(groupEl: Element, group: WebGroupDef, raw: unknown): void {
  const items = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
  const count = items.length > 0 ? items.length : group.default_count
  if (count <= 0) {
    while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild)
    return
  }
  const children = Array.from(groupEl.children)
  const itemTemplate = children.find(c => c.getAttribute('data-layer'))
  if (!itemTemplate) return
  const itemBinding = indexByLayer(group.item_schema)
  while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild)
  for (let i = 0; i < count; i++) {
    const itemValues = items[i] ?? {}
    const clone = itemTemplate.cloneNode(true) as Element
    substituteElement(clone, itemBinding, itemValues, { binding: itemBinding, values: itemValues })
    groupEl.appendChild(clone)
  }
}

// ── Snippet resolution ──────────────────────────────────────────────

/** Replace every `{{token}}` occurrence in text nodes with its resolved
 *  value. Empty / missing values keep the literal `{{token}}` so the
 *  strategist can see what's unresolved. */
function resolveSnippetsInTree(root: Element, snippetMap: SnippetMap): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const re = /\{\{([\w.]+)\}\}/g
  let node = walker.nextNode() as Text | null
  while (node) {
    const text = node.nodeValue ?? ''
    if (text.includes('{{')) {
      const next = text.replace(re, (_, token) => {
        const v = snippetMap[token]
        return v ? v : `{{${token}}}`
      })
      if (next !== text) node.nodeValue = next
    }
    node = walker.nextNode() as Text | null
  }
}

// ── Aspect ratio placeholder text ───────────────────────────────────

/** Strip Brixies / Figma image-placeholder dimension labels from the
 *  rendered output. They show up in three forms:
 *    1. Bare text nodes like "504 × 378"
 *    2. Element whose textContent matches the pattern (e.g. a span
 *       wrapping the dimensions inside a placeholder div)
 *    3. `<img>` tags with no src — their `alt` text is the dimensions,
 *       and the browser falls back to rendering alt when src is missing.
 */
const ASPECT_RE = /^\s*\d{2,5}\s*[×x*]\s*\d{2,5}\s*$/i

function stripAspectRatioText(root: Element): void {
  // (1) Text nodes
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const dropTextNodes: Text[] = []
  let node = walker.nextNode() as Text | null
  while (node) {
    if (ASPECT_RE.test(node.nodeValue ?? '')) dropTextNodes.push(node)
    node = walker.nextNode() as Text | null
  }
  for (const t of dropTextNodes) t.nodeValue = ''

  // (2) Element subtrees whose entire textContent is just a dimension
  // — covers wrapper divs whose direct child is a styled <span> that
  // didn't get caught above due to nested whitespace text nodes.
  const all = root.querySelectorAll('*')
  for (const el of Array.from(all)) {
    if (el.tagName.toLowerCase() === 'img') continue
    if (el.querySelector('img, svg, picture, video')) continue
    const tc = (el.textContent ?? '').trim()
    if (tc && ASPECT_RE.test(tc)) {
      // Only clear if all children are text/inline (no structural
      // content we'd lose). Spans are fine to clear.
      const hasStructural = Array.from(el.children).some(c => {
        const t = c.tagName.toLowerCase()
        return t !== 'span' && t !== 'b' && t !== 'i' && t !== 'em' && t !== 'strong'
      })
      if (!hasStructural) el.textContent = ''
    }
  }

  // (3) <img> tags without src — clear alt so browsers don't render
  // the dimension as a fallback label.
  const imgs = root.querySelectorAll('img')
  for (const img of Array.from(imgs)) {
    const src = img.getAttribute('src')
    if (!src) {
      img.setAttribute('alt', '')
      img.setAttribute('aria-hidden', 'true')
    }
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

function setInnerText(el: Element, text: string, fallbackHtml?: string): void {
  if (!text && fallbackHtml) {
    el.innerHTML = fallbackHtml
    return
  }
  const firstSpan = Array.from(el.children).find(c => c.tagName.toLowerCase() === 'span')
  if (firstSpan && el.children.length === 1) {
    firstSpan.textContent = text
    return
  }
  el.textContent = text
}
