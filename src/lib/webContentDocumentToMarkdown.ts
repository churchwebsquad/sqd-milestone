/**
 * Minimal serializer: ContentDocument → markdown.
 *
 * Stage 5 of the copywriting pipeline (and the legacy
 * importCopywriterPageOutput flow) need to populate
 * `web_sections.source_markdown` so PageTextView renders content
 * after import. Previously this column was null on every import,
 * which is why the Text view came up empty.
 *
 * The output here doesn't have to round-trip losslessly via
 * `parseCoworkSectionMarkdown` — it just has to give the strategist
 * something readable to edit. On the first save, PageTextView calls
 * `rebindSectionFromMarkdown()` which re-parses + re-binds + writes
 * a fresh source_markdown back, so any quirks of this initial
 * serialization get fixed by the first edit.
 */
import type { ContentBlock, ContentDocument, ContentItem } from './webContentDocument'

export function contentDocumentToMarkdown(doc: ContentDocument | null): string {
  if (!doc || !Array.isArray(doc.blocks) || doc.blocks.length === 0) return ''
  const parts: string[] = []
  for (const block of doc.blocks) {
    const md = blockToMarkdown(block)
    if (md.trim()) parts.push(md)
  }
  return parts.join('\n\n').trim()
}

function blockToMarkdown(block: ContentBlock): string {
  switch (block.kind) {
    case 'tagline':
      return block.text ? `_${esc(block.text.trim())}_` : ''
    case 'heading': {
      const level = clampLevel(block.level ?? 2)
      return `${'#'.repeat(level)} ${esc((block.text ?? '').trim())}`
    }
    case 'subheading':
      return `### ${esc((block.text ?? '').trim())}`
    case 'description':
      // Rich-text descriptions land as HTML; the Text view shows them
      // verbatim. Markdown wraps plain text, prose stays as-is.
      return block.html ?? esc(block.text ?? '')
    case 'image':
      return block.url ? `![${esc(block.alt ?? '')}](${block.url})` : ''
    case 'video':
      return block.url ? `[${esc(block.label ?? 'Video')}](${block.url})` : ''
    case 'cta':
      return block.url
        ? `[${esc((block.label ?? 'Learn more').trim())}](${block.url})`
        : block.label ? `**${esc(block.label.trim())}**` : ''
    case 'items':
      return itemsToMarkdown(block)
    case 'name':
      return block.text ? `**${esc(block.text.trim())}**` : ''
    case 'role':
      return block.text ? `_${esc(block.text.trim())}_` : ''
    case 'email':
      return block.text ? `<${block.text.trim()}>` : ''
    case 'phone':
      return block.text ? `Phone: ${esc(block.text.trim())}` : ''
    case 'date':
      return block.text ? `_${esc(block.text.trim())}_` : ''
    case 'quote':
      return block.text ? `> ${esc(block.text.trim()).split('\n').join('\n> ')}` : ''
    case 'attribution':
      return block.text ? `— ${esc(block.text.trim())}` : ''
    case 'address':
      return block.text ? `${esc(block.text.trim())}` : ''
    case 'question':
      return block.text ? `**Q: ${esc(block.text.trim())}**` : ''
    case 'answer':
      return block.text ? esc(block.text.trim()) : ''
    default:
      return block.text ?? ''
  }
}

function itemsToMarkdown(block: ContentBlock): string {
  if (!block.items || block.items.length === 0) return ''
  // For bullet-list hints, render as a flat markdown list.
  const isBullets = block.hint === 'bullets'
  if (isBullets) {
    return block.items.map(it => `- ${itemSummary(it)}`).join('\n')
  }
  // Cards / team / faq / process: render each item as a small
  // sub-heading + body. The strategist will see a clearly-grouped
  // outline they can edit.
  return block.items.map((it, idx) => {
    const inner = it.blocks.map(blockToMarkdown).filter(s => s.trim()).join('\n\n')
    if (!inner.trim()) return ''
    return inner
  }).filter(Boolean).join('\n\n---\n\n')
}

function itemSummary(item: ContentItem): string {
  for (const b of item.blocks) {
    if (b.kind === 'heading' || b.kind === 'name' || b.kind === 'question') {
      return esc((b.text ?? '').trim())
    }
  }
  // Fallback — concatenate any text in the item
  for (const b of item.blocks) {
    if (b.text) return esc(b.text.trim())
  }
  return ''
}

function clampLevel(n: number): 1|2|3|4|5|6 {
  if (n <= 1) return 1
  if (n >= 6) return 6
  return Math.floor(n) as 1|2|3|4|5|6
}

function esc(s: string): string {
  // Markdown-light escaping. Don't touch existing markdown — that's
  // the point of round-tripping. Just guard the bare strings.
  return s
}
