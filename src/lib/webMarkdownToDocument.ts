/**
 * Markdown → ContentDocument parser.
 *
 * Cowork ships markdown with a predictable section/field structure:
 *
 *   ### HERO SECTION
 *
 *   **Tagline:** Where Faith Starts Young
 *   **H1:** Kids Ministry at Riverwood
 *   **Body:** Your child has a place here…
 *   **CTA Primary:** Pre-Register Your Kids → `https://riverwood.com/check-ins`
 *
 *   ---
 *
 *   ### DETAILS SECTION
 *   …
 *
 * Section breaks: `---` + `### TITLE` on the next non-blank line.
 * Field lines: `**Label:**` at the start, value follows (one line or
 * until the next field/blank).
 * CTA shape: `Label → \`URL\`` (also accepts `Label → URL` without
 * backticks).
 * Free paragraphs (no field tag) become description blocks.
 * Sub-headings `#### Name` open a nested items block.
 *
 * The parser produces ContentDocument shapes WITHOUT node_ids — callers
 * run `assignNodeIds(fresh, previous_ir_snapshot)` on the result so
 * identity is preserved across re-parses.
 *
 * Rule-based for v1 (deterministic, fast, free). When writers stray
 * from the template enough that this can't classify, we can swap to an
 * LLM-assisted extractor that emits the same shape — no downstream
 * code changes required because the output type is identical.
 */

import type { ContentBlock, ContentItem, ContentDocument, ContentBlockKind } from './webContentDocument'

// ── Public API ────────────────────────────────────────────────────────

export interface SectionFromMarkdown {
  /** Raw markdown for this section, verbatim. Persisted to
   *  `web_sections.source_markdown` as the Text view's source of truth. */
  source_markdown: string
  /** Parsed semantic IR. No node_ids yet — caller assigns them. */
  ir: ContentDocument
  /** Title pulled from the `### TITLE` heading. Null if the section
   *  block didn't start with a heading. */
  section_title: string | null
  /** 0-indexed position in the page. */
  position: number
}

export interface MarkdownParseContext {
  page_slug?: string
  page_title?: string
}

/** Split a full page's markdown into sections + parse each. The page
 *  is delimited by `### TITLE` headings; `---` separators between
 *  sections are tolerated but not required. Empty sections (no body
 *  after the heading) are dropped. */
export function parseCoworkPageMarkdown(
  pageMarkdown: string,
  context: MarkdownParseContext = {},
): SectionFromMarkdown[] {
  const blocks = splitIntoSectionBlocks(pageMarkdown)
  const total = blocks.length
  return blocks.map((block, idx) => ({
    source_markdown: block.markdown,
    section_title:   block.title,
    position:        idx,
    ir: parseCoworkSectionMarkdown(block.markdown, {
      ...context,
      position: idx,
      total_sections: total,
      section_title: block.title,
    }),
  }))
}

/** Parse one section's worth of markdown into a ContentDocument. */
export function parseCoworkSectionMarkdown(
  sectionMarkdown: string,
  context: MarkdownParseContext & {
    position?: number
    total_sections?: number
    section_title?: string | null
  } = {},
): ContentDocument {
  const stripped = stripSectionHeading(sectionMarkdown)
  const blocks   = parseBlocks(stripped)
  return {
    blocks,
    position:        context.position,
    total_sections:  context.total_sections,
    page_slug:       context.page_slug,
    page_title:      context.page_title,
    cowork_concept_hint: context.section_title ?? null,
    cowork_template_hint: null,
    section_job:     null,
  }
}

// ── Section splitting ─────────────────────────────────────────────────

interface SectionBlock {
  markdown: string
  title:    string | null
}

function splitIntoSectionBlocks(pageMarkdown: string): SectionBlock[] {
  // Match `### TITLE` headings at the start of a line. We split on these
  // and treat anything before the first heading as a page-level preamble
  // we drop (SEO / metadata blocks that don't belong in any section).
  const lines = pageMarkdown.split(/\r?\n/)
  const out: SectionBlock[] = []
  let current: { title: string | null; lines: string[] } | null = null
  const flush = () => {
    if (!current) return
    const md = current.lines.join('\n').trim()
    // Skip empty sections (heading with no body)
    if (md) out.push({ markdown: assembleSection(current.title, md), title: current.title })
    current = null
  }
  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(.+?)\s*$/)
    if (headingMatch) {
      flush()
      current = { title: headingMatch[1].trim(), lines: [] }
      continue
    }
    // `---` separator outside a section: drop. Inside: keep as content
    // (the section parser handles it).
    if (!current) continue
    current.lines.push(line)
  }
  flush()
  return out
}

function assembleSection(title: string | null, body: string): string {
  // Re-attach the title so `source_markdown` is round-trip identical.
  return title ? `### ${title}\n\n${body}` : body
}

function stripSectionHeading(sectionMarkdown: string): string {
  return sectionMarkdown.replace(/^###\s+.+?\r?\n+/, '')
}

// ── Block parsing ─────────────────────────────────────────────────────

const FIELD_LINE = /^\*\*([^:*]+):\*\*\s*(.*)$/
// Standard markdown headings INSIDE a section body. `### TITLE` was
// already consumed by splitIntoSectionBlocks at the page level — by the
// time we get here, anything triple-hash would be free-form prose
// (rare; if it shows up we let it fall through to paragraph collection).
const H1         = /^#\s+(.+?)\s*$/
const H2         = /^##\s+(.+?)\s*$/
const SUBHEADING = /^####\s+(.+?)\s*$/   // four hashes opens a nested items block
const BULLET     = /^\s*[-*]\s+(.+)$/
const NUMBERED   = /^\s*(\d+)\.\s+(.+)$/
const HR         = /^---+\s*$/

/** Walk lines of section markdown, emitting ContentBlocks. */
function parseBlocks(sectionBody: string): ContentBlock[] {
  const lines = sectionBody.split(/\r?\n/)
  const out: ContentBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Skip blanks
    if (!line.trim()) { i++; continue }
    // Horizontal rule — section break inside a section, ignore
    if (HR.test(line)) { i++; continue }
    // Sub-heading opens an items block (one item per sub-heading)
    if (SUBHEADING.test(line)) {
      const { items, consumed } = collectSubheadingItems(lines, i)
      const hint = inferItemsHintFromItems(items)
      out.push({ kind: 'items', items, hint })
      i += consumed
      continue
    }
    // Standard markdown headings inside a section body. Writers who use
    // `# Headline` instead of cowork's `**H1:** Headline` should still
    // get a heading block — the binder picks them up the same way.
    // Check H2 before H1 since both share the leading `#`.
    const h2match = line.match(H2)
    if (h2match) {
      out.push({ kind: 'heading', text: h2match[1].trim(), level: 2 })
      i++
      continue
    }
    const h1match = line.match(H1)
    if (h1match) {
      out.push({ kind: 'heading', text: h1match[1].trim(), level: 1 })
      i++
      continue
    }
    // Bullet / numbered list — collect contiguous items
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const { items, consumed, hint } = collectListItems(lines, i)
      out.push({ kind: 'items', items, hint })
      i += consumed
      continue
    }
    // Field line — single block of a known kind
    const fieldMatch = line.match(FIELD_LINE)
    if (fieldMatch) {
      const tag = fieldMatch[1].trim()
      const inline = fieldMatch[2].trim()
      // Collect continuation lines that aren't a new field / list / blank
      const { value, consumed } = collectFieldValue(lines, i + 1, inline)
      const block = fieldToBlock(tag, value)
      if (block) out.push(block)
      i += consumed + 1
      continue
    }
    // Free paragraph — accumulate until blank or list/field boundary
    const { paragraph, consumed } = collectParagraph(lines, i)
    if (paragraph) out.push({ kind: 'description', text: paragraph })
    i += consumed
  }
  return out
}

function collectFieldValue(lines: string[], start: number, inlineValue: string): { value: string; consumed: number } {
  const parts: string[] = []
  if (inlineValue) parts.push(inlineValue)
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) break
    if (FIELD_LINE.test(line)) break
    if (SUBHEADING.test(line)) break
    if (BULLET.test(line) || NUMBERED.test(line)) break
    if (HR.test(line)) break
    parts.push(line.trim())
    i++
  }
  return { value: parts.join(' ').trim(), consumed: i - start }
}

function collectParagraph(lines: string[], start: number): { paragraph: string; consumed: number } {
  const parts: string[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) break
    if (FIELD_LINE.test(line)) break
    if (SUBHEADING.test(line)) break
    if (BULLET.test(line) || NUMBERED.test(line)) break
    if (HR.test(line)) break
    parts.push(line.trim())
    i++
  }
  return { paragraph: parts.join(' ').trim(), consumed: Math.max(1, i - start) }
}

function collectListItems(lines: string[], start: number): { items: ContentItem[]; consumed: number; hint: 'bullets' | 'process' } {
  const items: ContentItem[] = []
  let i = start
  let numbered = false
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const numMatch = line.match(NUMBERED)
    const bulletMatch = line.match(BULLET)
    if (!numMatch && !bulletMatch) break
    if (numMatch) numbered = true
    const text = (numMatch?.[2] ?? bulletMatch![1]).trim()
    items.push({ blocks: [{ kind: 'description', text }] })
    i++
  }
  return { items, consumed: i - start, hint: numbered ? 'process' : 'bullets' }
}

function collectSubheadingItems(lines: string[], start: number): { items: ContentItem[]; consumed: number } {
  // Each `#### Name` opens a new item. The item's blocks are everything
  // until the next `####` heading or end of the section.
  const items: ContentItem[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    const headingMatch = line.match(SUBHEADING)
    if (!headingMatch) break
    const name = headingMatch[1].trim()
    i++
    // Collect lines until next ### or #### or end
    const blockLines: string[] = []
    while (i < lines.length) {
      const inner = lines[i]
      if (SUBHEADING.test(inner)) break
      // Outer-level `### TITLE` would not appear inside a section anyway, but guard
      if (/^###\s+/.test(inner)) break
      blockLines.push(inner)
      i++
    }
    const itemBlocks: ContentBlock[] = [
      { kind: 'name',  text: name },
      ...parseBlocks(blockLines.join('\n')),
    ]
    items.push({ blocks: itemBlocks })
  }
  return { items, consumed: i - start }
}

// ── Field-tag → ContentBlock ──────────────────────────────────────────

function fieldToBlock(tag: string, value: string): ContentBlock | null {
  if (!value) return null
  const normalized = tag.toLowerCase()
  // Heading levels: H1, H2, …
  const hMatch = normalized.match(/^h([1-6])$/)
  if (hMatch) {
    const level = Number(hMatch[1]) as 1 | 2 | 3 | 4 | 5 | 6
    const kind: ContentBlockKind = level >= 3 ? 'subheading' : 'heading'
    return { kind, text: value, level, source_key: tag }
  }
  // Direct synonyms
  if (normalized === 'tagline' || normalized === 'eyebrow') {
    return { kind: 'tagline', text: value, source_key: tag }
  }
  if (normalized === 'heading' || normalized === 'h' || normalized === 'title') {
    return { kind: 'heading', text: value, source_key: tag }
  }
  if (normalized === 'subheading' || normalized === 'sub' || normalized === 'subhead') {
    return { kind: 'subheading', text: value, source_key: tag }
  }
  if (normalized === 'body' || normalized === 'description' || normalized === 'content') {
    return { kind: 'description', text: value, source_key: tag }
  }
  if (normalized === 'cta' || normalized.startsWith('cta ') || normalized.endsWith(' cta')) {
    return parseCta(value, tag)
  }
  if (normalized === 'image' || normalized === 'photo' || normalized === 'illustration') {
    return { kind: 'image', url: extractFirstUrl(value), alt: value, source_key: tag }
  }
  if (normalized === 'video') {
    return { kind: 'video', url: extractFirstUrl(value), source_key: tag }
  }
  if (normalized === 'quote' || normalized === 'testimonial') {
    return { kind: 'quote', text: stripQuoteMarks(value), source_key: tag }
  }
  if (normalized === 'attribution' || normalized === 'attributed to' || normalized === 'by') {
    return { kind: 'attribution', text: value, source_key: tag }
  }
  if (normalized === 'email') {
    return { kind: 'email', text: value, source_key: tag }
  }
  if (normalized === 'phone') {
    return { kind: 'phone', text: value, source_key: tag }
  }
  if (normalized === 'address') {
    return { kind: 'address', text: value, source_key: tag }
  }
  if (normalized === 'date' || normalized === 'when') {
    return { kind: 'date', text: value, source_key: tag }
  }
  if (normalized === 'role' || normalized === 'title') {
    return { kind: 'role', text: value, source_key: tag }
  }
  if (normalized === 'name') {
    return { kind: 'name', text: value, source_key: tag }
  }
  // Fallback: treat as a labeled description with the tag preserved
  // in source_key so the binder can use it as a hint and the Text-view
  // round-trip stays lossless.
  return { kind: 'description', text: `${tag}: ${value}`, source_key: tag }
}

function parseCta(value: string, sourceKey: string): ContentBlock {
  // Accept: "Label → `URL`", "Label → URL", "Label - URL", "[Label](URL)"
  // 1) Markdown-link form
  const mdLink = value.match(/^\[([^\]]+)\]\(([^)]+)\)\s*$/)
  if (mdLink) return { kind: 'cta', label: mdLink[1].trim(), url: mdLink[2].trim(), source_key: sourceKey }
  // 2) Arrow form (→, ->, —, —)
  const arrowMatch = value.match(/^(.+?)\s*(?:→|->|—|—|\|)\s*`?(.+?)`?\s*$/)
  if (arrowMatch) return { kind: 'cta', label: arrowMatch[1].trim(), url: stripBackticks(arrowMatch[2]).trim(), source_key: sourceKey }
  // 3) Plain URL only
  if (/^https?:\/\/|^mailto:|^tel:|^\//.test(value.trim())) {
    return { kind: 'cta', label: '', url: value.trim(), source_key: sourceKey }
  }
  // 4) Plain text only — emit with empty URL; downstream validator will flag
  return { kind: 'cta', label: value, url: '', source_key: sourceKey }
}

function extractFirstUrl(value: string): string {
  const m = value.match(/https?:\/\/\S+|mailto:\S+|tel:\S+|\/\S+/)
  return m ? m[0] : value
}

function stripBackticks(s: string): string {
  return s.replace(/^`+|`+$/g, '')
}

function stripQuoteMarks(s: string): string {
  return s.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim()
}

function inferItemsHintFromItems(items: ContentItem[]): import('./webContentDocument').ItemsHint {
  // Heuristic: a leading `name` block in every item → team; `question`/
  // `answer` pairs → faq; otherwise cards.
  if (items.length === 0) return 'cards'
  const hasName = items.every(it => it.blocks.some(b => b.kind === 'name'))
  if (hasName) {
    const hasRoleOrEmail = items.some(it => it.blocks.some(b => b.kind === 'role' || b.kind === 'email'))
    if (hasRoleOrEmail) return 'team'
  }
  const hasQandA = items.every(it => it.blocks.some(b => b.kind === 'question'))
  if (hasQandA) return 'faq'
  return 'cards'
}
