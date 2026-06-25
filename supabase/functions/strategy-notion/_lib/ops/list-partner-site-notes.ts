// List Partner Site Notes from the Notion Web Support database.
//
// The database has a `notes type` select property; we filter to rows
// where the value is "Partner site notes". The Church details page →
// Web Squad section calls this op with the partner's church name to
// further narrow client-side (titles often include the church name).
//
// Returns the title, last_edited timestamp, public URL, and the first
// ~280 chars of body content so the AM can scan without leaving the
// app. Clicking a note opens it in Notion.

import { queryDatabaseAll, fetchPage, listBlockChildrenAll } from '../notion.ts'
import type { NotionBlock } from '../notion.ts'
import { DB } from './data-sources.ts'
import { richTextToMarkdown } from '../parsers.ts'
import type { NotionPage, NotionRichText } from '../types.ts'

const PROPERTY_NAME = 'notes type'
const FILTER_VALUE  = 'Partner site notes'
/** Body-preview char budget. Long enough to surface a meaningful
 *  first sentence; short enough to keep the list dense. */
const PREVIEW_CHAR_BUDGET = 280

export interface PartnerSiteNote {
  page_id:          string
  title:            string
  last_edited_at:   string | null
  url:              string
  preview:          string
}

export interface ListPartnerSiteNotesArgs {
  /** Optional case-insensitive title contains-match (e.g. church name).
   *  When omitted, returns every partner site note in the database. */
  titleFilter?: string
  /** Cap on returned notes — defaults to 20. Higher values pay the
   *  per-note block-fetch cost so the preview can be computed; only
   *  raise if the caller really needs to render more. */
  limit?: number
}

export async function listPartnerSiteNotes(args: ListPartnerSiteNotesArgs = {}): Promise<PartnerSiteNote[]> {
  const limit = Math.max(1, Math.min(50, args.limit ?? 20))

  // Notion's query API filters server-side on properties when the
  // property name + value are valid. We try `select` first; if the
  // property is actually a `multi_select`, Notion 400s on `select`
  // and we retry with `multi_select.contains`. Surfaces other 4xx as
  // errors so misconfiguration is obvious.
  let pages: NotionPage[]
  try {
    pages = await queryDatabaseAll(DB.WEB_SUPPORT, {
      filter: {
        property: PROPERTY_NAME,
        select:   { equals: FILTER_VALUE },
      },
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Notion's select-vs-multi_select shape mismatch comes back as a
    // 400 with body mentioning "multi_select" — fall through to that.
    if (/400/.test(msg) && /multi_select/i.test(msg)) {
      pages = await queryDatabaseAll(DB.WEB_SUPPORT, {
        filter: {
          property:     PROPERTY_NAME,
          multi_select: { contains: FILTER_VALUE },
        },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      })
    } else {
      throw err
    }
  }

  // Title filter (client-side because Notion's API doesn't support a
  // case-insensitive title-contains filter on title-property values).
  const needle = (args.titleFilter ?? '').trim().toLowerCase()
  const matching = needle
    ? pages.filter(p => extractTitle(p).toLowerCase().includes(needle))
    : pages

  // Cap then enrich. We fetch a shallow block tree (depth 1) per note
  // to build the preview — deep nesting isn't worth the round trips
  // for a list view.
  const top = matching.slice(0, limit)
  const enriched = await Promise.all(top.map(async (page) => {
    const title = extractTitle(page) || 'Untitled note'
    const url   = (page as unknown as { url?: string }).url ?? ''
    const lastEditedAt = (page as unknown as { last_edited_time?: string }).last_edited_time ?? null
    const preview = await buildPreview(page.id)
    return {
      page_id:        page.id,
      title,
      last_edited_at: lastEditedAt,
      url,
      preview,
    } satisfies PartnerSiteNote
  }))
  return enriched
}

function extractTitle(page: NotionPage): string {
  const props = (page as unknown as { properties?: Record<string, { type?: string; title?: NotionRichText[] }> }).properties ?? {}
  for (const value of Object.values(props)) {
    if (value?.type === 'title' && Array.isArray(value.title)) {
      return richTextToMarkdown(value.title).trim()
    }
  }
  return ''
}

/** Pull the first few text-bearing blocks and concat their text up to
 *  the preview char budget. Skips images, dividers, code blocks. */
async function buildPreview(pageId: string): Promise<string> {
  // Depth 1 is enough for the preview — toggles/columns are flattened
  // by the renderer regardless. fetchPage isn't needed here; we go
  // straight to children.
  void fetchPage // referenced to avoid unused-import lint if we drop it later
  const blocks = (await listBlockChildrenAll(pageId, 1)) as Array<NotionBlock & { _children?: NotionBlock[] }>
  const parts: string[] = []
  for (const b of blocks) {
    const text = blockToText(b)
    if (!text) continue
    parts.push(text)
    if (parts.join(' ').length >= PREVIEW_CHAR_BUDGET) break
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (joined.length <= PREVIEW_CHAR_BUDGET) return joined
  // Snap to the last word boundary inside the budget so we don't slice mid-word.
  const slice = joined.slice(0, PREVIEW_CHAR_BUDGET)
  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > 200 ? slice.slice(0, lastSpace) : slice) + '…'
}

function blockToText(b: NotionBlock): string | null {
  switch (b.type) {
    case 'paragraph':           return richTextToMarkdown(b.paragraph?.rich_text ?? [])
    case 'heading_1':           return richTextToMarkdown(b.heading_1?.rich_text ?? [])
    case 'heading_2':           return richTextToMarkdown(b.heading_2?.rich_text ?? [])
    case 'heading_3':           return richTextToMarkdown(b.heading_3?.rich_text ?? [])
    case 'bulleted_list_item':  return '• ' + richTextToMarkdown(b.bulleted_list_item?.rich_text ?? [])
    case 'numbered_list_item':  return richTextToMarkdown(b.numbered_list_item?.rich_text ?? [])
    case 'to_do':               return richTextToMarkdown(b.to_do?.rich_text ?? [])
    case 'callout':             return richTextToMarkdown(b.callout?.rich_text ?? [])
    case 'quote':               return richTextToMarkdown(b.quote?.rich_text ?? [])
    case 'toggle':              return richTextToMarkdown(b.toggle?.rich_text ?? [])
    default:                    return null
  }
}
