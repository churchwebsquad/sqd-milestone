import { normalizeBlock } from './parseCopyReviewHtml'
import type { ParsedCopyReview, ParsedCopyReviewPage, ParsedCopyReviewSection } from '../types/database'

/**
 * Serialize a parsed review tree to Markdown. Notion's import handles
 * Markdown cleanly via File → Import → Markdown & CSV (or copy-paste).
 *
 * Structure:
 *   # Review title
 *
 *   ## 📄 Homepage — /
 *
 *   ### SECTION 1 — HERO
 *
 *   **H1:** Inviting everyone…
 *
 *   **Primary CTA Button:** Plan Your Visit
 *
 *   ---
 *
 *   ## 📄 Visit — /visit
 *   …
 */
export function parsedToMarkdown(parsed: ParsedCopyReview): string {
  const header = `# ${parsed.title.trim() || 'Copy Review'}\n`
  const pages = parsed.pages.map(pageToMarkdown).join('\n\n---\n\n')
  return `${header}\n${pages}\n`
}

function pageToMarkdown(page: ParsedCopyReviewPage): string {
  const summary = [page.emoji, page.label, page.url ? `— ${page.url}` : '']
    .filter(Boolean)
    .join(' ')
    .trim()
  const head = `## ${summary}`
  const body = page.sections.map(sectionToMarkdown).filter(Boolean).join('\n\n')
  return body ? `${head}\n\n${body}` : head
}

function sectionToMarkdown(section: ParsedCopyReviewSection): string {
  const title = section.id === 'intro' || !section.label ? '' : `### ${section.label}\n\n`
  const blocks = section.blocks
    .map(raw => blockToMarkdown(normalizeBlock(raw)))
    .filter(Boolean)
    .join('\n\n')
  return `${title}${blocks}`.trim()
}

function blockToMarkdown(block: { label: string | null; text: string; kind?: string }): string {
  const text = block.text.trim()
  if (!text && !block.label) return ''
  if (block.label && text) return `**${block.label}:** ${text}`
  if (block.label) return `**${block.label}**`
  return text
}

// ── Merge re-upload into existing parsed tree ───────────────────────────────

export type MergeMode = 'replace' | 'merge'

/**
 * Merge a freshly-parsed upload into an existing review tree.
 *
 * - `replace`: returns `next` unchanged — caller should use this as the new tree.
 * - `merge`: for each page in `next`, replace any existing page with the same
 *    slug id; append otherwise. Pages in `existing` that aren't in `next` are
 *    kept as-is. Use this mode to add/refresh individual pages without losing
 *    other pages' review decisions.
 *
 * The review's title comes from `next` in both modes (so staff can rename
 * by re-uploading with a different top-level heading).
 */
export function mergeParsed(existing: ParsedCopyReview, next: ParsedCopyReview, mode: MergeMode): ParsedCopyReview {
  if (mode === 'replace') return next

  const nextIds = new Set(next.pages.map(p => p.id))
  const kept = existing.pages.filter(p => !nextIds.has(p.id))
  return {
    title: next.title || existing.title,
    pages: [...kept, ...next.pages],
  }
}

/** Count the blocks whose ids would disappear when applying a merge/replace.
 *  Used to warn staff that related decisions/comments will be orphaned. */
export function countDroppedBlocks(existing: ParsedCopyReview, resulting: ParsedCopyReview): number {
  const keep = new Set<string>()
  for (const p of resulting.pages)
    for (const s of p.sections)
      for (const b of s.blocks) keep.add(b.id)
  let dropped = 0
  for (const p of existing.pages)
    for (const s of p.sections)
      for (const b of s.blocks) if (!keep.has(b.id)) dropped++
  return dropped
}

/** Immutably replace a single block's text in the parsed tree. */
export function replaceBlockText(parsed: ParsedCopyReview, blockId: string, nextText: string): ParsedCopyReview {
  return {
    title: parsed.title,
    pages: parsed.pages.map(p => ({
      ...p,
      sections: p.sections.map(s => ({
        ...s,
        blocks: s.blocks.map(b => b.id === blockId ? { ...b, text: nextText } : b),
      })),
    })),
  }
}

/** Trigger a browser download of the given text content. */
export function downloadText(content: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
