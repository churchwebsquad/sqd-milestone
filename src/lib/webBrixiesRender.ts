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
  cardTemplates?: Record<string, WebContentTemplate>,
): string {
  if (typeof window === 'undefined' || !template.source_html) return ''
  const doc = new DOMParser().parseFromString(template.source_html, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''

  // Stash card templates on the doc so expandGroup can reach them
  // without threading a parameter through every helper.
  ;(doc as { __cardTemplates?: Record<string, WebContentTemplate> }).__cardTemplates = cardTemplates ?? {}

  const topByLayer = indexByLayer(template.fields)
  // Pre-pass: top-level groups whose layer is NESTED inside another
  // top-level group's element (e.g. Feature 66's `tab_button` hoisted
  // to top level but the source's Tab buttons live inside each Tab)
  // must be substituted first. Otherwise the outer group's expansion
  // walks INTO the inner group's elements, sees a layer name like
  // "Heading" that matches the outer item_schema, and clobbers the
  // outer slot's match. Pre-substituting marks them with
  // data-substituted="1", and substituteElement skips marked subtrees.
  preprocessNestedTopLevelGroups(root, template.fields, values)
  substituteElement(root, topByLayer, values, /* itemContext */ null)

  if (snippetMap) resolveSnippetsInTree(root, snippetMap)
  stripAspectRatioText(root)
  neutralizePlaceholderImages(root)
  unstackAbsoluteSiblings(root)
  renumberDecorativeSequences(root)
  fixDecorativeAbsoluteStacking(root)
  wrapOverflowingFlexContainers(root)
  styleHyperlinks(root)
  neutralizeLoremPlaceholders(root)
  neutralizeDefaultButtonLabels(root)
  hideEmptyButtonShells(root)

  return root.outerHTML
}

/** Brixies sources often use horizontal carousels (`data-layer="Slider"`
 *  with multiple fixed-width Slide children) that overflow the static
 *  preview viewport — visible as cards stacking, overlapping, or being
 *  clipped. Since the preview iframe has no scroll, force flex-wrap on
 *  flex containers whose children's TOTAL fixed width clearly exceeds
 *  the 1512px viewport. Galleries that fit exactly (e.g. 3 × 504px
 *  images = 1512px) are NOT wrapped — they're designed to fit. */
const VIEWPORT_WIDTH = 1512
const OVERFLOW_THRESHOLD = VIEWPORT_WIDTH + 100

function wrapOverflowingFlexContainers(root: Element): void {
  const all = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const el of all) {
    const style = el.getAttribute('style') ?? ''
    if (!/display\s*:\s*(?:inline-)?flex/i.test(style)) continue
    if (/flex-wrap\s*:\s*(?:wrap|wrap-reverse)/i.test(style)) continue
    // Skip column-direction flex — wrapping wouldn't help horizontally.
    if (/flex-direction\s*:\s*column/i.test(style)) continue
    const dataChildren = Array.from(el.children).filter(c => c.hasAttribute('data-layer'))
    if (dataChildren.length < 3) continue
    let totalWidth = 0
    let widthedChildren = 0
    for (const c of dataChildren) {
      const s = c.getAttribute('style') ?? ''
      const w = /width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(s)
      if (w) {
        totalWidth += parseFloat(w[1])
        widthedChildren++
      }
    }
    if (widthedChildren < 3) continue
    if (totalWidth < OVERFLOW_THRESHOLD) continue
    el.setAttribute('style', appendStyle(style, 'flex-wrap: wrap'))
  }
}

/** Underline inline hyperlinks so they're visually distinct from plain
 *  text. Buttons (Brixies CTA wrappers) have `<a>` tags created by
 *  applyCta with an explicit `text-decoration: none` style — those are
 *  skipped so the button's label doesn't get underlined inside its
 *  pill. Only richtext links (no inline text-decoration) get the
 *  underline treatment. */
function styleHyperlinks(root: Element): void {
  for (const a of Array.from(root.querySelectorAll('a'))) {
    const style = a.getAttribute('style') ?? ''
    if (/text-decoration\s*:/i.test(style)) continue
    a.setAttribute('style', appendStyle(style, 'text-decoration: underline; text-underline-offset: 2px'))
  }
}

/** Brixies/Figma exports sometimes emit decorative `position: absolute`
 *  wrappers (e.g. Content 80's "Background overlap" — a dark band that
 *  should sit BEHIND the video). The export typically doesn't include
 *  a z-index on the wrapper or `position: relative` on the parent, so
 *  the absolute element stacks on top of static siblings and covers
 *  the foreground content.
 *
 *  Fix: for absolute elements that have a background-color/background
 *  declaration AND no text/media descendants (purely decorative),
 *  force z-index: -1 and ensure the parent establishes a stacking
 *  context (position: relative + z-index: 0) so the negative z-index
 *  is contained. */
function fixDecorativeAbsoluteStacking(root: Element): void {
  const all = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const el of all) {
    const style = el.getAttribute('style') ?? ''
    if (!/position\s*:\s*absolute/i.test(style)) continue

    const hasText = (el.textContent ?? '').trim().length > 0
    const hasMedia = el.querySelector('img, svg, video, picture, iframe') !== null
    if (hasText || hasMedia) continue

    // Only neutralize when the element has a background declaration —
    // a transparent absolute wrapper isn't a stacking culprit.
    const hasBg = /background(?:-color|-image)?\s*:/i.test(style)
    if (!hasBg) continue

    if (!/z-index\s*:/i.test(style)) {
      el.setAttribute('style', appendStyle(style, 'z-index: -1'))
    }

    const parent = el.parentElement
    if (parent) {
      const pStyle = parent.getAttribute('style') ?? ''
      let next = pStyle
      if (!/position\s*:/i.test(pStyle)) {
        next = appendStyle(next, 'position: relative')
      }
      if (!/z-index\s*:/i.test(next)) {
        next = appendStyle(next, 'z-index: 0')
      }
      if (next !== pStyle) parent.setAttribute('style', next)
    }
  }
}

function appendStyle(existing: string, addition: string): string {
  const trimmed = existing.trim()
  if (!trimmed) return addition
  return trimmed.endsWith(';') ? `${trimmed} ${addition}` : `${trimmed}; ${addition}`
}

// ── Lorem placeholder neutralization ────────────────────────────────

/** Brixies source HTML ships sample text like "Lorem ipsum dolor sit
 *  amet…" inside containers the importer didn't surface as editable
 *  fields. After substitution, any remaining lorem text is purely
 *  Brixies's design-tool sample — clear it so the preview shows an
 *  empty slot instead of placeholder copy the strategist can't
 *  override. The schema augmenter handles the editability side; this
 *  is the visual safety net.
 *
 *  Brixies rotates through several lorem variants ("Lorem ipsum…",
 *  "Eos laudantium repellat…", "Illum sit dolores…", etc.) so the
 *  prefix list covers the common starts. A density check fires only
 *  on dense Latin filler (≥50% of tokens are marker words AND ≥5
 *  hits) so legitimate English copy containing accidental matches
 *  like "in" or "et" isn't accidentally wiped. */
const LOREM_PREFIXES = [
  /^lorem\s+ipsum/i,
  /^eos\s+laudantium/i,
  /^illum\s+sit\s+dolores/i,
  /^consectetur\s+adipiscing/i,
  /^dolor\s+sit\s+amet/i,
  /^sed\s+do\s+eiusmod/i,
  /^ut\s+enim\s+ad\s+minim/i,
]
// Distinctively-Latin marker words. Excludes short English-overlapping
// tokens (in, et, id, est, do, sit, non, ea, ut, ex, ad, eu, sed) so
// the density test can't be tripped by ordinary English sentences.
const LOREM_MARKERS = new Set([
  'lorem','ipsum','dolor','amet','consectetur','adipiscing','elit',
  'eiusmod','tempor','incididunt','labore','dolore','magna','aliqua',
  'veniam','quis','nostrud','exercitation','ullamco','laboris','nisi',
  'aliquip','commodo','consequat','duis','aute','irure','reprehenderit',
  'voluptate','velit','cillum','fugiat','pariatur','excepteur','sint',
  'occaecat','cupidatat','proident','culpa','officia','deserunt','mollit',
  'laborum','laudantium','repellat','architecto','illum','dolores',
  'voluptatem','possimus','magnam','cupiditate','veritatis','accusamus',
  'quisquam','tincidunt',
])

function looksLikeLorem(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  for (const re of LOREM_PREFIXES) if (re.test(t)) return true
  // Density test: only triggers on Latin-dense blocks. Requires both
  // ≥5 marker hits AND ≥50% marker density, so a heading like "Live
  // in Christ" or "Faith and hope" can't accidentally trip.
  const tokens = t.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (tokens.length < 5) return false
  let hits = 0
  for (const tk of tokens) {
    if (LOREM_MARKERS.has(tk)) hits++
  }
  return hits >= 5 && hits * 2 >= tokens.length
}

function neutralizeLoremPlaceholders(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    if (looksLikeLorem(node.nodeValue ?? '')) node.nodeValue = ''
    node = walker.nextNode() as Text | null
  }
}

/** Brixies source HTML ships every button with a canned default label
 *  ("Learn more", "Contact now", "Sign Up", etc.). When the section's
 *  CTA slot wasn't bound by the strategist, the source default leaks
 *  into the rendered output as a real-looking pointer-to-nowhere link.
 *
 *  Detect: text nodes whose entire trimmed content matches a known
 *  default label AND whose ancestor is recognizable as a button shell
 *  (has data-layer that includes "button" or "contact", OR is inside
 *  an <a> wrapper applyCta inserted). Clear the text — the styled
 *  button outline stays visible so the strategist sees where a CTA
 *  goes, but the placeholder copy disappears. */
const DEFAULT_BUTTON_LABELS = new Set([
  'learn more', 'learn more →', 'learn more.', 'read more',
  'contact now', 'contact us', 'sign up', 'sign up now',
  'get started', 'get started now', 'subscribe', 'subscribe now',
  'try it free', 'try for free', 'start free trial', 'start free',
  'book a demo', 'request a demo', 'request demo', 'schedule a call',
  'discover more', 'find out more', 'explore now', 'view more',
  'see more', 'shop now', 'buy now', 'join now', 'join us',
  'register', 'register now', 'apply now', 'download', 'download now',
])

function isInsideButtonShell(node: Node): boolean {
  let el: Element | null = node.parentElement
  while (el) {
    const layer = el.getAttribute?.('data-layer')?.toLowerCase() ?? ''
    if (layer.includes('button') || layer.includes('cta') || layer === 'contact'
        || layer === 'contact us' || layer === 'contact now') return true
    el = el.parentElement
  }
  return false
}

function neutralizeDefaultButtonLabels(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    const v = (node.nodeValue ?? '').trim().toLowerCase()
    if (v && DEFAULT_BUTTON_LABELS.has(v) && isInsideButtonShell(node)) {
      node.nodeValue = ''
    }
    node = walker.nextNode() as Text | null
  }
}

/** Hide leaf button shells whose label is empty after binding +
 *  default-label neutralization. Resolves the Brixies-source "phantom
 *  button" symptom: when a CTA slot is unbound, the source's styled
 *  button element still renders as an empty pill in the preview, which
 *  reads as a broken layout. Better to hide it entirely — the bind
 *  inspector surfaces the empty slot separately so the signal isn't
 *  lost; the preview just stops showing buttons that have nothing
 *  to render.
 *
 *  Three-pass detection so we catch button shells whether they're
 *  tagged with data-layer (Figma export convention) or are raw
 *  <button> / <a> tags Brixies inlined without the layer attribute:
 *
 *  1. data-layer pass — leaf containers with layer name matching
 *     button/cta/contact patterns. The original (and still primary)
 *     signal for Brixies CTA wrappers.
 *  2. <button> pass — any <button> tag with empty text + no img/svg.
 *  3. <a> pass — anchor tags with empty text AND no meaningful href
 *     (no href, href="#", href="", or href="javascript:..."). An
 *     anchor with a real destination but no label is still hide-worthy
 *     because the user can't see where it goes; bind inspector still
 *     surfaces the empty label slot. */
function hideEmptyButtonShells(root: Element): void {
  // Pass 1 — data-layer button shells (leaf-only)
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-layer]'))) {
    if (!isButtonShellLayer(el)) continue
    if (hasNestedButtonShell(el)) continue
    if (hasMeaningfulContent(el)) continue
    forceHide(el)
  }

  // Pass 2 — raw <button> tags lacking content
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('button'))) {
    if (hasMeaningfulContent(el)) continue
    forceHide(el)
  }

  // Pass 3 — raw <a> tags lacking content (and ideally no real href)
  for (const el of Array.from(root.querySelectorAll<HTMLAnchorElement>('a'))) {
    if (hasMeaningfulContent(el)) continue
    // Only target anchors that ALSO have no meaningful href, so we
    // don't hide an icon-only link that intentionally has no visible
    // text but does navigate somewhere. Brixies-generated empty CTAs
    // typically have no href at all (the bind step would have set one).
    if (hasMeaningfulHref(el)) continue
    forceHide(el)
  }
}

function isButtonShellLayer(el: Element): boolean {
  const layer = (el.getAttribute('data-layer') ?? '').toLowerCase()
  return layer.includes('button') || layer.includes('cta')
         || layer === 'contact' || layer === 'contact us' || layer === 'contact now'
}

function hasNestedButtonShell(el: Element): boolean {
  for (const child of Array.from(el.querySelectorAll('[data-layer]'))) {
    if (isButtonShellLayer(child)) return true
  }
  return false
}

/** "Meaningful content" = visible text, OR an img/svg/input that
 *  carries its own visual weight. An empty button with whitespace-only
 *  text and no media is what we want to hide. */
function hasMeaningfulContent(el: Element): boolean {
  if ((el.textContent ?? '').trim().length > 0) return true
  if (el.querySelector('img, svg, video, picture, iframe, input') !== null) return true
  return false
}

function hasMeaningfulHref(a: HTMLAnchorElement): boolean {
  const href = (a.getAttribute('href') ?? '').trim()
  if (!href) return false
  if (href === '#' || href.startsWith('#')) return false
  if (/^javascript:/i.test(href)) return false
  return true
}

function forceHide(el: Element): void {
  const existing = el.getAttribute('style') ?? ''
  const cleaned = existing.replace(/;?\s*display\s*:\s*[^;]+;?/gi, '').replace(/^\s*;/, '').trim()
  el.setAttribute('style', (cleaned ? cleaned + ';' : '') + 'display:none')
}

/** When N identically-named siblings all carry `position: absolute`
 *  (common for Brixies image-fan patterns that only ship one
 *  positioned tile in the static export), my expander clones them as
 *  siblings at the same coordinates and they stack into one blob.
 *  Strip the absolute positioning + offset/transform so they participate
 *  in the parent's flex layout. */
function unstackAbsoluteSiblings(root: Element): void {
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const parent of all) {
    const dataChildren = Array.from(parent.children).filter(c => c.hasAttribute('data-layer'))
    if (dataChildren.length < 2) continue
    const groups = new Map<string, Element[]>()
    for (const c of dataChildren) {
      const name = c.getAttribute('data-layer') ?? ''
      const arr = groups.get(name)
      if (arr) arr.push(c)
      else groups.set(name, [c])
    }
    for (const sibs of groups.values()) {
      if (sibs.length < 2) continue
      const allAbsolute = sibs.every(el => /position\s*:\s*absolute/i.test(el.getAttribute('style') ?? ''))
      if (!allAbsolute) continue
      for (const el of sibs) {
        const s = el.getAttribute('style') ?? ''
        const next = s
          .replace(/position\s*:\s*absolute\s*;?/gi, '')
          .replace(/(^|;)\s*(left|top|right|bottom)\s*:\s*[^;]+;?/gi, '$1')
          .replace(/(^|;)\s*transform-origin\s*:\s*[^;]+;?/gi, '$1')
          .replace(/(^|;)\s*transform\s*:\s*rotate\([^)]+\)\s*;?/gi, '$1')
        el.setAttribute('style', next)
      }
    }
  }
}

/** Walk the substituted tree once and renumber decorative numeric
 *  placeholders ("01" / "Step 01") across every set of repeated
 *  same-name siblings. Runs after all group expansion so it can't
 *  be overwritten by outer expansions. */
function renumberDecorativeSequences(root: Element): void {
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const parent of all) {
    const dataChildren = Array.from(parent.children).filter(c => c.hasAttribute('data-layer'))
    if (dataChildren.length < 2) continue
    // Group by data-layer name
    const groups = new Map<string, Element[]>()
    for (const c of dataChildren) {
      const name = c.getAttribute('data-layer') ?? ''
      const arr = groups.get(name)
      if (arr) arr.push(c)
      else groups.set(name, [c])
    }
    for (const sibs of groups.values()) {
      if (sibs.length < 2) continue
      for (let i = 0; i < sibs.length; i++) {
        renumberInside(sibs[i], i + 1)
      }
    }
  }
}

function renumberInside(el: Element, oneIndexed: number): void {
  const padded = String(oneIndexed).padStart(2, '0')
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    const v = node.nodeValue ?? ''
    const trimmed = v.trim()
    if (/^\d{1,3}$/.test(trimmed)) {
      node.nodeValue = v.replace(trimmed, padded)
    } else if (/^Step\s+\d{1,3}$/i.test(trimmed)) {
      node.nodeValue = v.replace(/\d{1,3}/, padded)
    }
    node = walker.nextNode() as Text | null
  }
}

// ── Placeholder image neutralization ────────────────────────────────

/** Brixies / Figma exports leave `<img src="https://placehold.co/340x340">`
 *  on image slots that the strategist hasn't filled. Those served images
 *  literally render the dimension text on a gray rectangle. Replace
 *  with a transparent gray data URI so the slot keeps its size in the
 *  layout without showing the dimensions. */
const PLACEHOLDER_HOSTS = [
  'placehold.co', 'placehold.it', 'via.placeholder.com',
  'placeholder.com', 'dummyimage.com', 'placekitten.com',
  'loremflickr.com',
]

const NEUTRAL_GRAY_PIXEL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 4 4"><rect width="4" height="4" fill="#e5e7eb"/></svg>',
)

const DARK_GRAY_PIXEL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 4 4"><rect width="4" height="4" fill="#374151"/></svg>',
)

/** Some Brixies templates (Feature 109's `<div data-layer="Image">`,
 *  Hero 102's root) carry a dark `linear-gradient(rgba(0,0,0,*))`
 *  overlay AND a placeholder URL. Because the source uses separate
 *  `background:` and `background-image:` declarations, the URL
 *  overrides the gradient — so stripping the URL leaves the section
 *  with no dark backdrop and white text becomes invisible. Detect
 *  this case via a regex on the element's style and substitute a
 *  dark gray pixel instead so contrast is preserved. */
const DARK_OVERLAY_RE = /linear-gradient\(\s*[^)]*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/i

function neutralizePlaceholderImages(root: Element): void {
  // (1) <img> tags pointing at a placeholder service.
  const imgs = root.querySelectorAll('img')
  for (const img of Array.from(imgs)) {
    const src = img.getAttribute('src') ?? ''
    if (!src) continue
    const isPlaceholder = PLACEHOLDER_HOSTS.some(h => src.includes(h))
    if (isPlaceholder) {
      // Pick dark gray when this img is part of a hero (covers a large
      // area with absolute positioning) AND the section has white text
      // overlaid. Feature 76's hero image is the full-section backdrop
      // with white tab buttons on top — light gray ruins contrast.
      const imgStyle = img.getAttribute('style') ?? ''
      const isAbsolute = /position\s*:\s*absolute/i.test(imgStyle)
      const widthMatch = /width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(imgStyle)
      const isLarge = widthMatch && parseFloat(widthMatch[1]) >= 1000
      const hasDarkOverlay = DARK_OVERLAY_RE.test(imgStyle)
      const useDark = hasDarkOverlay
        || (isAbsolute && isLarge && hasWhiteTextDescendant(root))
      img.setAttribute('src', useDark ? DARK_GRAY_PIXEL : NEUTRAL_GRAY_PIXEL)
      img.setAttribute('alt', '')
      img.setAttribute('aria-hidden', 'true')
    }
  }

  // (2) Inline `style="background-image: url(placehold.co/...)"` (and
  // shorthand `background: url(...) ...`) on any element. Most Brixies
  // sections use this pattern — a div with a fixed size, a #d9d9d9
  // background-color, AND a placeholder background-image showing the
  // dimensions on top. Some hero variants ALSO carry a dark overlay
  // gradient that depends on the placeholder image being there to
  // produce a "photo with overlay" look — stripping the URL to none
  // leaves the gradient over transparent, washing out the section.
  // Replace the placeholder URL with a neutral gray data-URI so the
  // gradient still produces a dark background and white text on
  // buttons / headings remains visible.
  // INCLUDE the root element itself — Hero 102's giant 1512×982
  // placeholder is on the root div, which querySelectorAll skips.
  const scrub = (el: Element) => {
    const style = el.getAttribute('style')
    if (!style) return
    if (!PLACEHOLDER_HOSTS.some(h => style.includes(h))) return
    // Pick a darker placeholder pixel when the element OR its
    // descendants suggest white-on-image styling (dark overlay
    // gradients OR white text inside). Otherwise default light gray.
    const useDark = DARK_OVERLAY_RE.test(style) || hasWhiteTextDescendant(el)
    const pixel = useDark ? DARK_GRAY_PIXEL : NEUTRAL_GRAY_PIXEL
    const grayUrl = `url("${pixel}")`
    const next = style.replace(PLACEHOLDER_URL_RE, grayUrl)
    if (next !== style) el.setAttribute('style', next)
  }
  scrub(root)
  for (const el of Array.from(root.querySelectorAll('*'))) scrub(el)
}

/** Best-effort signal that text inside this element is intended to
 *  render on a dark background — used to decide between light-gray
 *  and dark-gray placeholder pixels. */
function hasWhiteTextDescendant(el: Element): boolean {
  const all = el.querySelectorAll('*')
  for (const child of Array.from(all)) {
    const style = child.getAttribute('style') ?? ''
    if (/color\s*:\s*(?:white|#fff|#ffffff|rgba?\(\s*255\s*,\s*255\s*,\s*255)/i.test(style)) return true
  }
  return false
}

// Matches `url(https://placehold.co/504x378)` (with optional quotes,
// optional protocol) for any of the known placeholder hosts.
const PLACEHOLDER_URL_RE = new RegExp(
  'url\\(\\s*["\']?(?:https?:)?\\/\\/[^)\\s"\']*(?:'
  + PLACEHOLDER_HOSTS.map(h => h.replace(/\./g, '\\.')).join('|')
  + ')[^)\\s"\']*["\']?\\s*\\)',
  'gi',
)

// ── Substitution ────────────────────────────────────────────────────

/** Identify top-level groups whose layer occurs INSIDE another
 *  top-level group's source element, and pre-substitute them before
 *  the main walk so the outer group's expansion doesn't clobber their
 *  inner slots. Marks substituted elements with data-substituted="1"
 *  so substituteElement skips them.
 *
 *  Canonical case: Feature 66 has `tab` (4 content blocks) and
 *  `tab_button` (4 buttons) at top level after the schema hoist.
 *  Tab buttons live inside each Tab's "Tab heading container", so
 *  Tab buttons appear 16 times (4 per Tab × 4 Tabs) but the user
 *  edits them as ONE set of 4. The pre-pass fans the 4 user-edited
 *  values across all 16 Tab button instances and marks each — when
 *  `tab` is later expanded, its walker hits the marked Tab buttons
 *  and skips, leaving the content slots free to match correctly. */
function preprocessNestedTopLevelGroups(
  root: Element,
  fields: ReadonlyArray<WebFieldDef>,
  values: Record<string, unknown>,
): void {
  // Palette-referenced groups are handled exclusively by
  // expandPaletteGroup at main-walk time — they use the Card
  // template's fields as their item schema, and the user's value is
  // shaped { __palette_template_id, items } not a plain array. Skip
  // them here so the array-based fan-out doesn't mis-substitute them
  // and mark them data-substituted before expandPaletteGroup runs.
  const topGroups = fields.filter((f): f is WebGroupDef =>
    f.kind === 'group' && !f.item_template_ref,
  )
  if (topGroups.length < 2) return

  // For each top-level group, find ALL elements in source matching its layer.
  const groupMatches = new Map<WebGroupDef, Element[]>()
  for (const g of topGroups) {
    const target = g.layer_name ?? g.key
    const matches: Element[] = []
    for (const el of Array.from(root.querySelectorAll('[data-layer]'))) {
      if (el.getAttribute('data-layer') === target) matches.push(el)
    }
    if (matches.length > 0) groupMatches.set(g, matches)
  }
  if (groupMatches.size < 2) return

  // Three patterns trigger preprocess fan-out:
  //
  // A. FULLY NESTED (gEls.length >= 1, every match inside another
  //    top-level group's element). Feature 66's tab_button — all 16
  //    Tab buttons are inside Tabs. One set of user values fans
  //    across all of them.
  //
  // B. MULTI-PARENT (gEls.length >= 2, matches span 2+ parents, not
  //    fully nested). Process 19's two Card Items in different
  //    parents — distribute items across matches in DOM order so
  //    each visible Card Item receives ONE user value.
  //
  // For Feature 66's case where source has only 1 Tab button but the
  // user typed 3 tab_button items, pad clones in the same parent so
  // 3 buttons render with distinct labels.
  const nested: WebGroupDef[] = []
  for (const [g, gEls] of groupMatches) {
    if (gEls.length === 0) continue
    const allNested = gEls.length >= 1 && gEls.every(gEl => {
      for (const [other, otherEls] of groupMatches) {
        if (other === g) continue
        for (const otherEl of otherEls) {
          if (otherEl !== gEl && otherEl.contains(gEl)) return true
        }
      }
      return false
    })
    const parents = new Set<Element | null>(gEls.map(el => el.parentElement))
    const multiParent = parents.size >= 2
    if (allNested || multiParent) nested.push(g)
  }

  for (const g of nested) {
    const matches = groupMatches.get(g) ?? []
    const items = Array.isArray(values[g.key]) ? values[g.key] as Array<Record<string, unknown>> : []
    const count = items.length > 0 ? items.length : g.default_count

    // Group matches by parent.
    const byParent = new Map<Element, Element[]>()
    for (const el of matches) {
      const p = el.parentElement
      if (!p) continue
      const arr = byParent.get(p) ?? []
      arr.push(el)
      byParent.set(p, arr)
    }

    const itemBinding = indexByLayer(Array.isArray(g.item_schema) ? g.item_schema : [])
    const oneMatchPerParent = byParent.size >= 2
      && Array.from(byParent.values()).every(arr => arr.length === 1)

    if (oneMatchPerParent) {
      // Multi-parent distribution: matches[i] gets items[i].
      // For Process 19's pattern where the second Card Item lives
      // inside a positional wrapper but is logically the 2nd item.
      const fill = Math.min(matches.length, count)
      for (let i = 0; i < fill; i++) {
        const itemValues = items[i] ?? {}
        substituteElement(matches[i], itemBinding, itemValues,
          { binding: itemBinding, values: itemValues })
        matches[i].setAttribute('data-substituted', '1')
      }
      // Remove extra matches beyond what the user has items for.
      for (let i = count; i < matches.length; i++) {
        matches[i].parentElement?.removeChild(matches[i])
      }
      // Pad: if the user has MORE items than source matches, clone
      // the FIRST match into its parent (the natural row container).
      // Cloning the last match would mean appending into whichever
      // positional wrapper the second source sample lived in (Process
      // 19's "Card item wrapper" with absolute positioning) — extras
      // would stack weirdly inside that wrapper. The first match is
      // typically a direct child of the main row/list, which lays out
      // its children correctly without the positional quirks.
      if (count > matches.length) {
        const firstMatch = matches[0]
        const firstParent = firstMatch?.parentElement
        if (firstMatch && firstParent) {
          // Insert AFTER the last existing sibling-of-same-name in this
          // parent (could be just firstMatch, or more if siblings share
          // the parent). For Process 19 specifically firstMatch is the
          // only same-layer child of List, so we append at end.
          const sameLayerSibs = Array.from(firstParent.children)
            .filter(c => c.getAttribute('data-layer') === firstMatch.getAttribute('data-layer'))
          const lastSameLayer = sameLayerSibs[sameLayerSibs.length - 1]
          const anchor = lastSameLayer?.nextSibling ?? null
          for (let i = matches.length; i < count; i++) {
            const clone = firstMatch.cloneNode(true) as Element
            clone.removeAttribute('data-substituted')
            const itemValues = items[i] ?? {}
            substituteElement(clone, itemBinding, itemValues,
              { binding: itemBinding, values: itemValues })
            clone.setAttribute('data-substituted', '1')
            firstParent.insertBefore(clone, anchor)
          }
        }
      }
      continue
    }

    // Per-parent fan-out: every parent's siblings get items[0..count-1].
    // Pads with clones in each parent if count > siblings.length;
    // trims extras if count < siblings.length.
    for (const [p, sibs] of byParent.entries()) {
      const fill = Math.min(sibs.length, count)
      for (let i = 0; i < fill; i++) {
        const itemValues = items[i] ?? {}
        substituteElement(sibs[i], itemBinding, itemValues,
          { binding: itemBinding, values: itemValues })
        sibs[i].setAttribute('data-substituted', '1')
      }
      for (let i = count; i < sibs.length; i++) {
        p.removeChild(sibs[i])
      }
      if (count > sibs.length) {
        const template = sibs[0]
        const anchor = sibs[sibs.length - 1].nextSibling
        for (let i = sibs.length; i < count; i++) {
          const clone = template.cloneNode(true) as Element
          clone.removeAttribute('data-substituted')
          const itemValues = items[i] ?? {}
          substituteElement(clone, itemBinding, itemValues,
            { binding: itemBinding, values: itemValues })
          clone.setAttribute('data-substituted', '1')
          p.insertBefore(clone, anchor)
        }
      }
    }
  }
}

function substituteElement(
  el: Element,
  binding: Map<string, WebFieldDef>,
  values: Record<string, unknown>,
  itemContext: ItemContext | null,
  filled: Set<string> = new Set(),
): void {
  // Skip subtrees already substituted by a pre-pass (the cross-parent
  // fan-out for nested top-level groups in Feature 66's tab_button
  // pattern, etc.). Without this, the outer group's expansion would
  // walk into these subtrees and mis-match their elements against the
  // outer item_schema.
  if (el.getAttribute('data-substituted') === '1') return
  const layer = el.getAttribute('data-layer')
  if (layer) {
    const field = lookup(binding, layer)
    if (field?.kind === 'slot' && !filled.has(field.key)) {
      if (!isDecorativeNumericPlaceholder(el, field)) {
        applySlot(el, field, values[field.key])
        filled.add(field.key)
        // Image slots may live on a frame `<div>` that ALSO contains
        // other slots (e.g. Feature 109's Image frame wraps Heading +
        // Description). For non-img image slots, keep walking children.
        if (!(field.type === 'image' && el.tagName.toLowerCase() !== 'img')) return
      }
    } else if (field?.kind === 'group' && !filled.has(field.key)) {
      expandGroup(el, field, values[field.key])
      filled.add(field.key)
      return
    } else if (itemContext) {
      const itemField = lookup(itemContext.binding, layer)
      if (itemField?.kind === 'slot' && !filled.has(itemField.key)) {
        if (!isDecorativeNumericPlaceholder(el, itemField)) {
          applySlot(el, itemField, itemContext.values[itemField.key])
          filled.add(itemField.key)
          if (!(itemField.type === 'image' && el.tagName.toLowerCase() !== 'img')) return
        }
      } else if (itemField?.kind === 'group' && !filled.has(itemField.key)) {
        expandGroup(el, itemField, itemContext.values[itemField.key])
        filled.add(itemField.key)
        return
      }
    }
  }
  for (const child of Array.from(el.children)) {
    substituteElement(child, binding, values, itemContext, filled)
  }
}

/** Some Brixies cards share `data-layer="Heading"` between a decorative
 *  numeric placeholder (e.g. a giant "01") and the real heading. Both
 *  match the schema's heading slot, but only the substantive one should
 *  receive the user's copy. Detect placeholders by their existing text:
 *  pure 1-3 digit numbers, or "Step 01" patterns. */
function isDecorativeNumericPlaceholder(el: Element, slot: WebSlotDef): boolean {
  if (slot.type !== 'text' && slot.type !== 'richtext') return false
  const txt = (el.textContent ?? '').trim()
  if (!txt) return false
  return /^\d{1,3}$/.test(txt) || /^Step\s+\d{1,3}$/i.test(txt)
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
  const url = (cta.url ?? '').trim()
  const label = (cta.label ?? '').trim()
  // Don't hide the element when label/url are empty — a hidden button
  // produces "dropped CTA" complaints in unbound sections. The
  // post-render pass `neutralizeDefaultButtonLabels` strips known
  // Brixies placeholder labels so the source default doesn't leak
  // through as a real-looking CTA.
  if (label) {
    // Preserve the inner styled wrapper that carries the button's
    // typography (color, font-size, font-weight). Brixies sources
    // typically nest a styled `<div data-layer="Contact">` inside a
    // wrapper `<div data-layer="Buttons">` — the wrapper holds the
    // background fill and the inner div holds `color: white`. Writing
    // the label to `el.textContent` would replace the inner div with
    // a plain text node and the text would inherit black from the
    // cascade, producing dark-on-dark contrast failures. Instead,
    // find the deepest text-bearing leaf and update its text only.
    const leaf = findButtonLabelLeaf(el)
    if (leaf) leaf.textContent = label
    else el.textContent = label
  }
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

/** Walk descendants depth-first; return the first leaf-ish element
 *  carrying non-trivial text. Skips decorative siblings (icons / SVGs
 *  / images) so a button's icon doesn't get clobbered with the label. */
function findButtonLabelLeaf(el: Element): Element | null {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase()
    if (tag === 'svg' || tag === 'img' || tag === 'picture' || tag === 'a') continue
    if (child.children.length === 0) {
      const txt = (child.textContent ?? '').trim()
      if (txt && !/^\d{1,3}$/.test(txt)) return child
      continue
    }
    const inner = findButtonLabelLeaf(child)
    if (inner) return inner
    // Element has children but none were text leaves — if its own
    // direct text is substantive, treat it as the leaf.
    const ownText = (child.textContent ?? '').trim()
    if (ownText && !/^\d{1,3}$/.test(ownText)) return child
  }
  return null
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
  // Palette-referenced groups defer their item template to a Card-
  // family template loaded separately. When available in __cardTemplates,
  // clone the Card's source for each item and substitute using the
  // Card's own fields schema.
  if (group.item_template_ref) {
    expandPaletteGroup(groupEl, group, raw)
    return
  }
  const items = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
  const itemSchema = Array.isArray(group.item_schema) ? group.item_schema : []
  // Honor items.length when the strategist has supplied items; fall
  // back to the template's design-time default_count for unbound
  // groups so the section preserves its visual structure (rows of
  // cards / step lists / etc.). Without this, ANY section whose
  // import didn't include this specific group rendered as a giant
  // hole — Feature 109, Content 1, FAQ 10, etc. Lorem-text
  // neutralization + placeholder-image scrubbing handle the
  // "leaked default copy" concern that prompted the earlier removal.
  const count = items.length > 0 ? items.length : group.default_count
  if (count <= 0) {
    while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild)
    return
  }
  const itemBinding = indexByLayer(itemSchema)

  // When the source already has 2+ siblings of the same data-layer
  // as groupEl in the SAME parent (e.g. Feature 66's 4 stacked
  // `<Tab>` elements inside Container), treat them as existing
  // instances and substitute each in place rather than wiping siblings
  // and replicating one. Without this, only the first sibling gets
  // the user's values and the rest keep their lorem-state source
  // content.
  //
  // Cross-parent fan-out (the same layer appearing in multiple
  // parents) is handled separately by preprocessNestedTopLevelGroups
  // for legitimate top-level nested cases. Doing it inside expandGroup
  // for ALL groups misfires badly for nested groups like Buttons
  // inside each Tab — each Tab's expansion would substitute Buttons
  // in OTHER Tabs with the current Tab's values, clobbering them.
  const parent = groupEl.parentElement
  if (parent) {
    const targetLayer = groupEl.getAttribute('data-layer') ?? ''
    const siblings = Array.from(parent.children)
      .filter(c => c.getAttribute('data-layer') === targetLayer) as Element[]
    if (siblings.length >= 2) {
      // Use the richest sibling as template for any clones we need
      // to add beyond what's in source.
      const template = findRichestItemTemplate(siblings[0], group, groupEl)
      // Substitute each existing sibling
      const fill = Math.min(siblings.length, count)
      for (let i = 0; i < fill; i++) {
        const itemValues = items[i] ?? {}
        substituteElement(siblings[i], itemBinding, itemValues,
          { binding: itemBinding, values: itemValues })
      }
      // Trim extras
      for (let i = count; i < siblings.length; i++) {
        parent.removeChild(siblings[i])
      }
      // Add clones if count > siblings.length
      if (count > siblings.length) {
        const anchor = siblings[siblings.length - 1].nextSibling
        for (let i = siblings.length; i < count; i++) {
          const clone = template.cloneNode(true) as Element
          const itemValues = items[i] ?? {}
          substituteElement(clone, itemBinding, itemValues,
            { binding: itemBinding, values: itemValues })
          parent.insertBefore(clone, anchor)
        }
      }
      return
    }
  }

  const decision = decideItemTemplate(groupEl, group)
  if (!decision) return

  // The default item template might be a partial source sample that
  // doesn't carry every layer the schema's slots target. FAQ 10 is the
  // canonical case: the schema's `description` slot points at the long
  // lorem-ipsum text layer that only lives inside the "open state"
  // sample (Accordion left's Frame 57). The "closed state" samples
  // (Frame 62/65/66) get chosen as the template and lack that element,
  // so substitution writes the user's description into nothing.
  //
  // Search the surrounding scope (the group's parent subtree) for the
  // richest element — one with the most schema slot layers in its
  // subtree — and prefer it as the item template when it covers more
  // slots. Ties broken by smallest descendant count (most-specific).
  const richestTemplate = findRichestItemTemplate(decision.template, group, groupEl)

  // Insert each clone BEFORE substituting it. Nested group expansions
  // (e.g. card inside container_right) need parentElement set, and
  // it isn't until the clone is in the tree. With the old order
  // (substitute → return → caller inserts), placement='self' nested
  // groups would see `parent === null` and bail without substituting.
  const insertAndSubstitute = (i: number, insertParent: Element, beforeNode: Node | null): Element => {
    const itemValues = items[i] ?? {}
    const clone = richestTemplate.cloneNode(true) as Element
    insertParent.insertBefore(clone, beforeNode)
    substituteElement(clone, itemBinding, itemValues, { binding: itemBinding, values: itemValues })
    return clone
  }

  if (decision.placement === 'self') {
    // The matched element IS the item — replicate it in the parent
    // (preserving sibling order) and remove the original.
    const parent = groupEl.parentElement
    if (!parent) {
      // groupEl is detached (we're inside an outer cloneAndSubstitute
      // before that clone was inserted). Substitute the single first
      // item in-place — best we can do without a parent to replicate
      // into. Multi-item expansion requires re-attachment.
      if (count > 0) {
        const itemValues = items[0] ?? {}
        substituteElement(groupEl, itemBinding, itemValues, { binding: itemBinding, values: itemValues })
      }
      return
    }
    const insertBefore = groupEl.nextSibling
    parent.removeChild(groupEl)
    for (let i = 0; i < count; i++) insertAndSubstitute(i, parent, insertBefore)
    return
  }

  // groupEl is a container — wipe its children and fill with N clones
  // of the inner item template.
  while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild)
  for (let i = 0; i < count; i++) insertAndSubstitute(i, groupEl, null)
}

/** Expand a palette-referenced group by loading the referenced Card
 *  template and using ITS source_html + ITS item_schema for each item.
 *  Lets sections like Feature 22 / 82 / 106 render any Card variant
 *  the strategist picks. The user-selected card template ID is stored
 *  in field_values as `__palette_template__<group_key>`; falls back to
 *  the schema's referenced_template_id when no user override. */
function expandPaletteGroup(groupEl: Element, group: WebGroupDef, raw: unknown): void {
  // Backward-compatible read: raw can be an array (legacy: uses
  // schema's default referenced_template_id) OR an object
  // `{ __palette_template_id, items }` written by the panel's
  // template picker.
  let items: Array<Record<string, unknown>> = []
  let userTemplateId: string | undefined
  if (Array.isArray(raw)) {
    items = raw as Array<Record<string, unknown>>
  } else if (raw && typeof raw === 'object') {
    const v = raw as { __palette_template_id?: string; items?: Array<Record<string, unknown>> }
    userTemplateId = v.__palette_template_id
    items = Array.isArray(v.items) ? v.items : []
  }
  const count = items.length > 0 ? items.length : (group.default_count ?? 1)
  if (count <= 0) {
    while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild)
    return
  }

  const doc = groupEl.ownerDocument
  const cardTemplates = (doc as { __cardTemplates?: Record<string, WebContentTemplate> }).__cardTemplates ?? {}
  const cardId = userTemplateId ?? group.referenced_template_id
  const cardTemplate = cardId ? cardTemplates[cardId] : null
  if (!cardTemplate || !cardTemplate.source_html) {
    // No card template available — leave groupEl as a placeholder.
    return
  }

  // Pick the Card's section root (first element child of the template's parsed source_html).
  const cardDoc = new DOMParser().parseFromString(cardTemplate.source_html, 'text/html')
  const cardRoot = cardDoc.body.firstElementChild
  if (!cardRoot) return

  // Build itemBinding from the Card template's top-level fields.
  // Card templates expose their slots/groups as fields on the template
  // itself — each item gets substituted against this binding.
  const cardItemSchema = Array.isArray(cardTemplate.fields) ? cardTemplate.fields : []
  const itemBinding = indexByLayer(cardItemSchema)

  // Palette substitution always REPLACES the placeholder element with
  // N siblings in its parent. The placeholder (whether <img> or <div>)
  // is a stand-in that the design tool renders once; the renderer fans
  // it out so siblings get the parent container's flex/grid layout
  // (e.g. Feature 2's Container Grid → 3-per-row wrap, Feature 82's
  // Slider → horizontal row that wraps when over-wide). Wipe-and-append
  // INSIDE the placeholder would stack N cards in a single column
  // because the placeholder itself usually has `flex-direction: column`.
  const parent = groupEl.parentElement
  if (!parent) return
  const anchor = groupEl.nextSibling
  parent.removeChild(groupEl)
  for (let i = 0; i < count; i++) {
    const itemValues = items[i] ?? {}
    const clone = cardRoot.cloneNode(true) as Element
    const adopted = doc.importNode(clone, true) as Element
    parent.insertBefore(adopted, anchor)
    substituteElement(adopted, itemBinding, itemValues,
      { binding: itemBinding, values: itemValues })
  }
}

interface ItemDecision {
  template: Element
  placement: 'self' | 'inner'
}

/** Figure out whether `groupEl` IS the item template (clone it as a
 *  sibling in its parent) or whether it's a CONTAINER whose inner
 *  data-layer child is the item template (clone the child inside it).
 *
 *  Brixies templates use both patterns:
 *    • `<Buttons>` element IS the item — its only child is the slot
 *      ("Contact").
 *    • `<Card>` element IS the item — its children are nested wrappers
 *      ("Icon card", "Frame 106") that eventually contain the slots.
 *    • `<Row List>` element IS the item — its only child is the next
 *      group ("Item list") in the schema.
 *    • A wrapper element CONTAINS the item — its only data-layer child
 *      is a "Card"/"Slide" element that holds the slots.
 */
function decideItemTemplate(groupEl: Element, group: WebGroupDef): ItemDecision | null {
  const itemSchema = Array.isArray(group.item_schema) ? group.item_schema : []
  // Layer names at the top of item_schema — both slots and groups.
  const schemaLayers = itemSchema.map(f => f.layer_name ?? f.key)

  if (itemSchema.length === 0) {
    // No slots — groupEl IS the item (e.g. an <img> placeholder group).
    return { template: groupEl, placement: 'self' }
  }

  const directDataChildren = Array.from(groupEl.children)
    .filter(c => c.hasAttribute('data-layer'))

  if (directDataChildren.length === 0) {
    // No data-layer children at all — fall back to self.
    return { template: groupEl, placement: 'self' }
  }

  // (a) Any direct child matches a schema layer → groupEl is the item.
  const anyDirectMatches = directDataChildren.some(c => {
    const n = c.getAttribute('data-layer')
    return n != null && schemaLayers.some(s => sameLayer(s, n))
  })
  if (anyDirectMatches) return { template: groupEl, placement: 'self' }

  // (b) All direct children share the same layer name → list of items
  // in a container. Clone the first one inside groupEl.
  const childLayerNames = new Set(
    directDataChildren.map(c => c.getAttribute('data-layer') ?? ''),
  )
  if (childLayerNames.size === 1) {
    return { template: directDataChildren[0], placement: 'inner' }
  }

  // (c) Exactly one data-layer child and it contains the schema's slot
  // descendants → that child is the item template, clone it inside.
  if (directDataChildren.length === 1) {
    return { template: directDataChildren[0], placement: 'inner' }
  }

  // (d) Multiple distinct children that look like sibling instances of
  // the same item (FAQ accordions with Frame 62/66/65 each carrying
  // Heading 4 + Text). Distinguishing this from heterogeneous wrappers
  // (e.g. Tab → [Tab heading container, Tab content container]) needs
  // a SIGNATURE check: only treat groupEl as a container of items when
  // 2+ direct children share substantially the same descendant layer
  // set (≥70% overlap of the smaller signature, ≥2 layers in common).
  const childSignatures = directDataChildren.map(c => {
    const set = new Set<string>()
    for (const desc of Array.from(c.querySelectorAll('[data-layer]'))) {
      const n = desc.getAttribute('data-layer')?.trim().toLowerCase().replace(/\s+/g, ' ')
      if (n) set.add(n)
    }
    return set
  })
  for (let i = 0; i < directDataChildren.length; i++) {
    for (let j = i + 1; j < directDataChildren.length; j++) {
      const a = childSignatures[i], b = childSignatures[j]
      const small = a.size <= b.size ? a : b
      const big = a.size <= b.size ? b : a
      if (small.size < 2) continue
      let overlap = 0
      for (const v of small) if (big.has(v)) overlap++
      if (overlap >= 2 && overlap / small.size >= 0.7) {
        return { template: directDataChildren[i], placement: 'inner' }
      }
    }
  }

  // (e) Multiple distinct children and none match the schema layers —
  // groupEl is the item (its descendants contain the slots). Common
  // for cards whose source has decorative wrappers (Icon + Frame).
  return { template: groupEl, placement: 'self' }
}

function subtreeContainsLayer(el: Element, layerName: string): boolean {
  const target = layerName.trim().toLowerCase().replace(/\s+/g, ' ')
  const self = el.getAttribute('data-layer')?.trim().toLowerCase().replace(/\s+/g, ' ')
  if (self === target) return true
  for (const child of Array.from(el.querySelectorAll('[data-layer]'))) {
    const n = child.getAttribute('data-layer')?.trim().toLowerCase().replace(/\s+/g, ' ')
    if (n === target) return true
  }
  return false
}

/** Find a richer item template when the default one is missing schema
 *  slot layers. Searches the group's parent subtree (sibling samples)
 *  for an element whose subtree covers MORE of the schema's slots.
 *  Ties broken by smallest descendant count (most-specific item).
 *  Returns the original template when nothing strictly better is
 *  found — so this is a no-op for clean templates. */
function findRichestItemTemplate(
  baseTemplate: Element,
  group: WebGroupDef,
  groupEl: Element,
): Element {
  const itemSchema = Array.isArray(group.item_schema) ? group.item_schema : []
  const slotLayers = itemSchema
    .filter((f): f is WebSlotDef => f.kind === 'slot')
    .map(f => f.layer_name ?? f.key)
  if (slotLayers.length === 0) return baseTemplate

  const presentCount = (el: Element): number => {
    let n = 0
    for (const sl of slotLayers) if (subtreeContainsLayer(el, sl)) n++
    return n
  }
  const baseCount = presentCount(baseTemplate)
  if (baseCount === slotLayers.length) return baseTemplate

  const searchScope = groupEl.parentElement ?? groupEl
  let best = baseTemplate
  let bestCount = baseCount
  let bestSize = baseTemplate.querySelectorAll('*').length

  for (const cand of Array.from(searchScope.querySelectorAll('[data-layer]'))) {
    if (cand === baseTemplate) continue
    // Skip ancestors of groupEl — they wrap the whole section and
    // would replace too much when cloned as a single item.
    if (cand.contains(groupEl)) continue
    const count = presentCount(cand)
    if (count < bestCount) continue
    const size = cand.querySelectorAll('*').length
    if (count > bestCount || (count === bestCount && size < bestSize)) {
      best = cand
      bestCount = count
      bestSize = size
    }
  }
  return best
}

function sameLayer(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, ' ')
       === b.trim().toLowerCase().replace(/\s+/g, ' ')
}

// ── Snippet resolution ──────────────────────────────────────────────

/** Replace every `{{token}}` occurrence in text nodes with its resolved
 *  value, wrapping each substitution in `<span class="wm-snippet-token">`
 *  so the partner-facing preview renders snippets in the brand's
 *  distinctive purple. Empty / missing values keep the literal
 *  `{{token}}` (also wrapped) so unresolved tokens stand out as
 *  needing attention. The iframe's stylesheet (see PagePreview's
 *  `buildIframeDoc`) provides the `.wm-snippet-token` color rule. */
function resolveSnippetsInTree(root: Element, snippetMap: SnippetMap): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const re = /\{\{([\w.]+)\}\}/g
  // Collect first, mutate after — replacing a text node during walk
  // confuses the TreeWalker's cursor and skips siblings.
  const pending: Array<{ node: Text; pieces: Array<string | { snippet: string }> }> = []
  let node = walker.nextNode() as Text | null
  while (node) {
    const text = node.nodeValue ?? ''
    if (text.includes('{{')) {
      const pieces: Array<string | { snippet: string }> = []
      let lastIdx = 0
      const localRe = new RegExp(re.source, 'g')
      let m: RegExpExecArray | null
      while ((m = localRe.exec(text)) !== null) {
        if (m.index > lastIdx) pieces.push(text.slice(lastIdx, m.index))
        const token = m[1]
        const v = snippetMap[token]
        pieces.push({ snippet: v ? v : `{{${token}}}` })
        lastIdx = localRe.lastIndex
      }
      if (lastIdx < text.length) pieces.push(text.slice(lastIdx))
      if (pieces.some(p => typeof p !== 'string')) pending.push({ node, pieces })
    }
    node = walker.nextNode() as Text | null
  }
  for (const { node: textNode, pieces } of pending) {
    const doc = textNode.ownerDocument
    const frag = doc.createDocumentFragment()
    for (const p of pieces) {
      if (typeof p === 'string') {
        frag.appendChild(doc.createTextNode(p))
      } else {
        const span = doc.createElement('span')
        span.className = 'wm-snippet-token'
        span.textContent = p.snippet
        frag.appendChild(span)
      }
    }
    textNode.parentNode?.replaceChild(frag, textNode)
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
  if (!Array.isArray(fields)) return m
  for (const f of fields) {
    const layer = f.layer_name ?? f.key
    const existing = m.get(layer)
    // Schema augmenter occasionally emits duplicate fields under the
    // same layer — Content Section 16 has a `description` SLOT AND an
    // empty `description` GROUP both with layer_name "Description".
    // Picking arbitrarily lets the empty group win and the slot's
    // value binding never runs (lorem stays). Prefer the more
    // specific field: a real slot beats an empty group; a group with
    // a populated item_schema beats any slot. */
    if (existing && fieldSpecificity(f) <= fieldSpecificity(existing)) continue
    m.set(layer, f)
  }
  return m
}

function fieldSpecificity(f: WebFieldDef): number {
  if (f.kind === 'slot') return 2 // any typed slot
  if (f.kind === 'group') {
    const items = Array.isArray(f.item_schema) ? f.item_schema.length : 0
    return items > 0 ? 3 : 1 // populated group beats slot; empty group loses to slot
  }
  return 0
}

function lookup(map: Map<string, WebFieldDef>, layerName: string): WebFieldDef | undefined {
  if (map.has(layerName)) return map.get(layerName)
  const norm = layerName.trim().toLowerCase().replace(/\s+/g, ' ')
  for (const [k, v] of map.entries()) {
    if (k.trim().toLowerCase().replace(/\s+/g, ' ') === norm) return v
  }
  // Numbered sibling variants: source has "Card 01" / "Card 02" / etc.
  // and the schema has a single group with layer_name="Card" and
  // numbered_sibling_variants=true. Strip the trailing " NN" pattern
  // and accept a match only if the candidate group carries that flag.
  const m = layerName.match(/^(.+?)\s+\d{1,3}$/)
  if (m) {
    const baseNorm = m[1].toLowerCase().replace(/\s+/g, ' ').trim()
    for (const [k, v] of map.entries()) {
      if (v.kind !== 'group' || v.numbered_sibling_variants !== true) continue
      if (k.trim().toLowerCase().replace(/\s+/g, ' ') === baseNorm) return v
    }
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
