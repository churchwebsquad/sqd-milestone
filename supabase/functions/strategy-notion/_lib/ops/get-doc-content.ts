import { cached, TTL } from '../cache.ts'
import { fetchPage, listBlockChildrenAll } from '../notion.ts'
import type { NotionBlock } from '../notion.ts'
import { pageToDoc, richTextToMarkdown } from '../parsers.ts'
import type { DocBlock, DocContent, NotionRichText } from '../types.ts'

/** Fetch a doc page + its block tree, flattened into the thin `DocBlock`
 *  shape the client renders. Cached briefly so a back-and-forth between
 *  the doc detail and Library doesn't re-hit Notion. */
export async function getDocContent(id: string): Promise<DocContent | null> {
  return cached(`doc-content:${id}`, TTL.initiativeDetail, async () => {
    const [page, rawBlocks] = await Promise.all([
      fetchPage(id),
      // Bumped from 2 → 3 so nested column-list content (which adds an
      // extra wrapper level) and toggle-inside-callout patterns still
      // load their leaves. Each extra level is one more `/blocks/{id}/
      // children` round-trip per block-with-children, but Notion docs
      // tend to be shallow in practice.
      listBlockChildrenAll(id, 3),
    ])
    return {
      doc: pageToDoc(page),
      blocks: rawBlocks.map(flattenBlock).filter((b): b is DocBlock => !!b),
    }
  })
}

function rt(runs: NotionRichText[] | undefined): string {
  return runs ? richTextToMarkdown(runs) : ''
}

function flattenBlock(b: NotionBlock & { _children?: NotionBlock[] }): DocBlock | null {
  return flattenSharedBlock(b, rt)
}

/** Shared flattener used by both Doc Hub and Action Item content fetchers.
 *  Kept here so the renderer additions live in one place. Each returned
 *  DocBlock carries the Notion block ID so the in-app body editor can
 *  PATCH /v1/blocks/{id} when the user saves an inline edit. */
export function flattenSharedBlock(
  b: NotionBlock & { _children?: NotionBlock[] },
  rtFn: (runs: NotionRichText[] | undefined) => string,
): DocBlock | null {
  const children = b._children
    ? b._children.map(c => flattenSharedBlock(c, rtFn)).filter((c): c is DocBlock => !!c)
    : undefined
  const id = b.id

  switch (b.type) {
    case 'paragraph':
      return { id, type: 'paragraph', text: rtFn(b.paragraph?.rich_text), children }
    case 'heading_1':
      return { id, type: 'heading_1', text: rtFn(b.heading_1?.rich_text) }
    case 'heading_2':
      return { id, type: 'heading_2', text: rtFn(b.heading_2?.rich_text) }
    case 'heading_3':
      return { id, type: 'heading_3', text: rtFn(b.heading_3?.rich_text) }
    case 'bulleted_list_item':
      return { id, type: 'bulleted_list_item', text: rtFn(b.bulleted_list_item?.rich_text), children }
    case 'numbered_list_item':
      return { id, type: 'numbered_list_item', text: rtFn(b.numbered_list_item?.rich_text), children }
    case 'to_do':
      return {
        id,
        type: 'to_do',
        text: rtFn(b.to_do?.rich_text),
        meta: { checked: b.to_do?.checked ?? false },
        children,
      }
    case 'toggle':
      return { id, type: 'toggle', text: rtFn(b.toggle?.rich_text), children }
    case 'callout':
      return {
        id,
        type: 'callout',
        text: rtFn(b.callout?.rich_text),
        meta: { emoji: b.callout?.icon?.emoji ?? null },
        children,
      }
    case 'quote':
      return { id, type: 'quote', text: rtFn(b.quote?.rich_text) }
    case 'code':
      return {
        id,
        type: 'code',
        text: rtFn(b.code?.rich_text),
        meta: { language: b.code?.language ?? null },
      }
    case 'divider':
      return { id, type: 'divider', text: '' }
    case 'image': {
      const url = b.image?.external?.url ?? b.image?.file?.url ?? null
      if (!url) return null
      return { id, type: 'image', text: '', url }
    }
    case 'bookmark': {
      const url = b.bookmark?.url ?? null
      if (!url) return null
      return {
        id,
        type: 'bookmark',
        text: url,
        url,
        meta: { caption: rtFn(b.bookmark?.caption) },
      }
    }
    case 'embed':
      return b.embed?.url
        ? { id, type: 'embed', text: b.embed.url, url: b.embed.url }
        : null
    case 'video': {
      const url = b.video?.external?.url ?? b.video?.file?.url ?? null
      if (!url) return null
      return { id, type: 'video', text: url, url }
    }
    case 'link_preview':
      return b.link_preview?.url
        ? { id, type: 'link_preview', text: b.link_preview.url, url: b.link_preview.url }
        : null
    case 'table':
      return {
        id,
        type: 'table',
        text: '',
        meta: {
          columnHeader: b.table?.has_column_header ?? false,
          rowHeader: b.table?.has_row_header ?? false,
        },
        children,
      }
    case 'table_row':
      return {
        id,
        type: 'table_row',
        text: '',
        cells: (b.table_row?.cells ?? []).map(cell => rtFn(cell)),
      }
    // Multi-column layout (`column_list` wraps `column` blocks which
    // wrap the actual content). We previously dropped these as
    // "unsupported", which silently swallowed every block inside a
    // multi-column section — bug surfaced as "Notion body content not
    // rendering" for any doc using columns. Flatten as a transparent
    // `container` and let the renderer pass children through.
    case 'column_list':
    case 'column':
    // Synced blocks mirror content from another page. The block has
    // a wrapper plus children; render the children inline as if they
    // were authored on this page (matches Notion's display behavior).
    case 'synced_block':
      return { id, type: 'container', text: '', children }
    // Subpages embedded in the doc — Notion exposes the title only.
    // We render a small card linking to the subpage in Notion rather
    // than trying to inline-flatten the child page (a rabbit hole
    // that'd require a separate page fetch).
    case 'child_page': {
      const title = b.child_page?.title ?? 'Subpage'
      return { id, type: 'child_page', text: title }
    }
    default:
      return { id, type: 'unsupported', text: `[${b.type}]` }
  }
}
