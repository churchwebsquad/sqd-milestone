import type {
  ParsedCopyReview,
  ParsedCopyReviewBlock,
  ParsedCopyReviewPage,
  ParsedCopyReviewSection,
} from '../types/database'

/**
 * Parses a Notion-exported copy review HTML doc into a clean tree of
 * pages → sections → blocks. Every block keeps its Notion `<p id="…">` uuid
 * so decisions and comments anchor to stable ids across re-parses.
 *
 * Expected input shape (Notion export, Feb 2026):
 *   <article class="page sans">
 *     <header><h1 class="page-title">…</h1></header>
 *     <div class="page-body">
 *       <ul class="toggle">
 *         <li><details><summary>📄 Homepage — /</summary>
 *           <h2>Page Copy</h2>
 *           <h3 id="…">SECTION 1 — HERO</h3>
 *           <div style="display:contents" dir="auto"><p id="…">H1: …</p></div>
 *           …
 *         </details></li>
 *         …
 *       </ul>
 *     </div>
 *   </article>
 */
export function parseCopyReviewHtml(html: string): ParsedCopyReview {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const titleEl = doc.querySelector('article.page h1.page-title, article h1.page-title, h1.page-title')
  const title = (titleEl?.textContent ?? '').trim() || 'Untitled Copy Review'

  const pages: ParsedCopyReviewPage[] = []
  // Notion wraps .toggle in `<div style="display:contents">`, so use descendant
  // (not direct-child) between .page-body and ul.toggle.
  const pageItems = doc.querySelectorAll('article .page-body ul.toggle > li > details')

  pageItems.forEach((details) => {
    const page = parsePage(details)
    if (page) pages.push(page)
  })

  return { title, pages }
}

function parsePage(details: Element): ParsedCopyReviewPage | null {
  const summary = details.querySelector(':scope > summary')
  if (!summary) return null

  const summaryText = (summary.textContent ?? '').trim()
  if (!summaryText) return null

  const { emoji, label, url } = parseSummary(summaryText)
  const id = slugify(label) || 'page'

  // Flatten descendants into an ordered list of content-bearing elements,
  // unwrapping Notion's <div style="display:contents"> wrappers.
  const flat: Element[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName
      if (tag === 'SUMMARY' || tag === 'HR' || tag === 'IMG' || tag === 'FIGURE') continue
      if (tag === 'P' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5') {
        flat.push(child)
      } else {
        walk(child) // unwrap div/section/span/etc.
      }
    }
  }
  walk(details)

  const sections: ParsedCopyReviewSection[] = []
  let current: ParsedCopyReviewSection = { id: 'intro', label: 'Intro', blocks: [] }

  for (const el of flat) {
    if (el.tagName === 'H3') {
      if (current.blocks.length > 0) sections.push(current)
      current = {
        id: el.id || `section-${sections.length + 1}`,
        label: (el.textContent ?? '').trim() || `Section ${sections.length + 1}`,
        blocks: [],
      }
      continue
    }
    if (el.tagName === 'H1' || el.tagName === 'H2') continue // page-level headers
    if (el.tagName === 'P') {
      const block = pToBlock(el)
      if (block) current.blocks.push(block)
    } else if (el.tagName === 'H4' || el.tagName === 'H5') {
      const text = (el.textContent ?? '').trim()
      if (text) {
        current.blocks.push({
          id: el.id || `block-${current.blocks.length + 1}`,
          kind: 'copy',
          label: el.tagName,
          text,
        })
      }
    }
  }

  if (current.blocks.length > 0) sections.push(current)
  return { id, label, url, emoji, sections }
}

function parseSummary(text: string): { emoji: string | null; label: string; url: string | null } {
  // "📄 Homepage — /" or "📄 Kids Page — /kids"
  // Split on em-dash (—) or the ASCII " - " separator.
  const emojiMatch = text.match(/^(\p{Extended_Pictographic})\s*(.*)$/u)
  const emoji = emojiMatch ? emojiMatch[1] : null
  const afterEmoji = emojiMatch ? emojiMatch[2] : text

  const sepMatch = afterEmoji.match(/^(.*?)\s*[—–-]\s*(\/[\w\-/]*|https?:\/\/\S+)\s*$/)
  if (sepMatch) {
    return { emoji, label: sepMatch[1].trim(), url: sepMatch[2].trim() }
  }
  return { emoji, label: afterEmoji.trim(), url: null }
}

const KNOWN_LABELS = [
  'H1', 'H2', 'H3', 'H4',
  'Primary CTA Button', 'Secondary CTA Button', 'CTA Button', 'CTA',
  'Button', 'Button Label',
  'Metadata Title', 'Metadata Description',
  'AEO Smart Snippet', 'AEO', 'Primary Keyword', 'Secondary Keyword',
  'Image', 'Image Alt',
  'Subheading', 'Subhead',
  'Body', 'Intro', 'Eyebrow',
]

function pToBlock(p: Element): ParsedCopyReviewBlock | null {
  const rawText = (p.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!rawText) return null

  const id = p.id || `anon-${hashString(rawText)}`

  // Metadata: <p><strong>Metadata Title</strong> (58 chars): …</p>
  const firstChild = p.firstElementChild
  if (firstChild && firstChild.tagName === 'STRONG') {
    const rawLabel = (firstChild.textContent ?? '').trim().replace(/:\s*$/, '')
    const rest = rawText.slice((firstChild.textContent ?? '').length).replace(/^\s*:\s*/, '').trim()
    // "Copy" is doc-structure noise (just tells the reviewer "this is copy") — drop it.
    if (isStructuralNoise(rawLabel)) {
      return { id, kind: 'copy', label: null, text: rest || rawText }
    }
    return { id, kind: 'metadata', label: rawLabel || null, text: rest || rawText }
  }

  // Labeled copy: "H1: …", "Primary CTA Button: Plan Your Visit"
  const colonIdx = rawText.indexOf(': ')
  if (colonIdx > 0 && colonIdx < 40) {
    const maybeLabel = rawText.slice(0, colonIdx).trim()
    const body = rawText.slice(colonIdx + 2).trim()
    if (isStructuralNoise(maybeLabel)) {
      return { id, kind: 'copy', label: null, text: body }
    }
    if (isKnownLabel(maybeLabel)) {
      return { id, kind: 'copy', label: maybeLabel, text: body }
    }
  }

  return { id, kind: 'copy', label: null, text: rawText }
}

function isStructuralNoise(label: string): boolean {
  return /^copy$/i.test(label.trim())
}

/** Strip doc-structure noise at display time. Safe for rows whose data was
 *  parsed before the isStructuralNoise check landed. */
export function normalizeBlock<B extends { label: string | null; text: string }>(b: B): B {
  const labelStripped = b.label ? b.label.trim().replace(/:\s*$/, '') : ''
  const labelIsNoise = isStructuralNoise(labelStripped)
  const label = labelIsNoise ? null : b.label
  // Also strip a leading "Copy: " from text if the original had it inline.
  const text = b.text.replace(/^copy\s*:\s*/i, '').trim() || b.text
  if (label === b.label && text === b.text) return b
  return { ...b, label, text }
}

function isKnownLabel(candidate: string): boolean {
  if (!candidate) return false
  if (candidate.length > 40) return false
  // Exact match against known labels (case-insensitive).
  const lower = candidate.toLowerCase()
  if (KNOWN_LABELS.some((k) => k.toLowerCase() === lower)) return true
  // H1…H6 / H1(a), H2(b), etc.
  if (/^h[1-6](\s*\(.+\))?$/i.test(candidate)) return true
  // "Button", "CTA", "Button #1", "CTA #2"
  if (/^(primary|secondary|tertiary)?\s*(cta|button)(\s*#?\d+)?(\s+button)?$/i.test(candidate)) return true
  return false
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function hashString(s: string): string {
  // Tiny non-cryptographic hash for stable anon ids.
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}
