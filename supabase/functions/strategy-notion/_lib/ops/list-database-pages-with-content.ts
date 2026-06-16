// Bulk page-with-body reader for cowork's audit-external-copy branch.
//
// The strategist pastes a Notion database URL on intake when partner
// copy is already in progress (e.g. Arvada Vineyard 3734). The cowork
// pipeline then audits the existing copy instead of generating from
// scratch. This op walks the database, fetches each page's body, and
// serializes everything into a flat shape suitable for the project
// context bundle the audit skill reads.
//
// Output per page:
//   { notion_page_id, title, slug, notion_url, body_markdown }
// where slug = lowercase title with non-alphanumerics → dashes.
//
// Body rendering is shallow markdown: headings, paragraphs, bulleted/
// numbered lists, callouts, quotes, code, dividers, toggles. Images
// + embeds collapse to placeholder lines so the audit can flag
// "expected image here" against canonical_templates' designer_slots.

import { queryDatabaseAll, listBlockChildrenAll } from '../notion.ts'
import type { NotionBlock } from '../notion.ts'
import { richTextToMarkdown } from '../parsers.ts'
import type { NotionPage, NotionRichText } from '../types.ts'

interface NotionPageWithContent {
  notion_page_id: string
  title:          string
  slug:           string
  notion_url:     string
  body_markdown:  string
}

/** Lowercase title, non-alphanumerics → dashes, collapse runs, trim.
 *  Mirrors the sitemap slugify used elsewhere so an audit comparing
 *  Notion pages to sitemap_pages can match by slug without per-side
 *  variation. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function readPageTitle(page: NotionPage): string {
  // Find any title-type property — Notion databases have exactly one,
  // but the property name varies per workspace (Name / Title / Page).
  const props = page.properties ?? {}
  for (const key of Object.keys(props)) {
    const v = (props as Record<string, unknown>)[key] as { type?: string; title?: NotionRichText[] }
    if (v?.type === 'title' && Array.isArray(v.title)) {
      return richTextToMarkdown(v.title).trim() || '(untitled)'
    }
  }
  return '(untitled)'
}

function rt(runs: NotionRichText[] | undefined): string {
  return runs ? richTextToMarkdown(runs) : ''
}

function blockToMarkdown(b: NotionBlock & { _children?: NotionBlock[] }, indent = 0): string {
  const pad = '  '.repeat(indent)
  const childrenMd = b._children
    ? b._children.map(c => blockToMarkdown(c, indent + 1)).filter(Boolean).join('\n')
    : ''

  let line = ''
  switch (b.type) {
    case 'paragraph':
      line = `${pad}${rt(b.paragraph?.rich_text)}`
      break
    case 'heading_1':
      line = `${pad}# ${rt(b.heading_1?.rich_text)}`
      break
    case 'heading_2':
      line = `${pad}## ${rt(b.heading_2?.rich_text)}`
      break
    case 'heading_3':
      line = `${pad}### ${rt(b.heading_3?.rich_text)}`
      break
    case 'bulleted_list_item':
      line = `${pad}- ${rt(b.bulleted_list_item?.rich_text)}`
      break
    case 'numbered_list_item':
      line = `${pad}1. ${rt(b.numbered_list_item?.rich_text)}`
      break
    case 'to_do':
      line = `${pad}- [${b.to_do?.checked ? 'x' : ' '}] ${rt(b.to_do?.rich_text)}`
      break
    case 'toggle':
      line = `${pad}<details><summary>${rt(b.toggle?.rich_text)}</summary>${childrenMd ? '\n' + childrenMd : ''}</details>`
      return line
    case 'callout':
      line = `${pad}> ${rt(b.callout?.rich_text)}`
      break
    case 'quote':
      line = `${pad}> ${rt(b.quote?.rich_text)}`
      break
    case 'code':
      line = `${pad}\`\`\`${b.code?.language ?? ''}\n${rt(b.code?.rich_text)}\n${pad}\`\`\``
      break
    case 'divider':
      line = `${pad}---`
      break
    case 'image':
      line = `${pad}![image]`
      break
    case 'video':
    case 'embed':
    case 'bookmark':
      line = `${pad}[embed: ${b.type}]`
      break
    default:
      // Unknown block types render as a debug placeholder; the audit
      // skill can decide whether to flag them.
      line = `${pad}[${b.type}]`
  }
  return childrenMd ? `${line}\n${childrenMd}` : line
}

export async function listDatabasePagesWithContent(
  databaseId: string,
): Promise<NotionPageWithContent[]> {
  const pages = await queryDatabaseAll(databaseId)
  // Notion's per-page block reads are sequential to avoid hammering the
  // 3-req/s rate limit. Concurrency=3 is a tested sweet spot. For
  // 10-page sitemaps this is ~3-4 seconds total.
  const CONCURRENCY = 3
  const out: NotionPageWithContent[] = []
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const slice = pages.slice(i, i + CONCURRENCY)
    const results = await Promise.all(slice.map(async (page) => {
      const title = readPageTitle(page)
      const blocks = await listBlockChildrenAll(page.id, 3)
      const body_markdown = blocks.map(b => blockToMarkdown(b)).filter(Boolean).join('\n\n')
      return {
        notion_page_id: page.id,
        title,
        slug:           slugify(title),
        notion_url:     page.url,
        body_markdown,
      }
    }))
    out.push(...results)
  }
  return out
}
