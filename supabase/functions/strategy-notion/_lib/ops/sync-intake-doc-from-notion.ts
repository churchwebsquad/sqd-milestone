// Sync a Notion page into the partner-project's intake documents.
//
// Given a notion URL (the AM already pasted into strategy_brief_notion_url
// or any page they pick), fetch the page + block tree, render to markdown,
// upload the markdown to the brand-assets bucket, and write a row to
// web_intake_documents with notion_* metadata pointing back at the source.
//
// The op is idempotent per (project_id, page_id) — re-running upserts the
// row + replaces the storage file rather than creating duplicates.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchPage, listBlockChildrenAll } from '../notion.ts'
import type { NotionBlock } from '../notion.ts'
import { richTextToMarkdown } from '../parsers.ts'
import type { NotionRichText } from '../types.ts'

export interface SyncIntakeDocArgs {
  projectId:   string
  notionUrl:   string
  category:    'strategy_brief' | 'content_strategy'
  uploadedBy?: string | null
}

export interface SyncIntakeDocResult {
  ok:                 true
  document_id:        string
  notion_page_id:     string
  storage_path:       string
  notion_synced_at:   string
  notion_last_edited_at: string | null
  markdown_bytes:     number
}

const INTAKE_BUCKET = 'brand-assets'

/** Notion page IDs are 32 hex characters. They show up in URLs in two
 *  shapes: dashed (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) or undashed
 *  (`xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`). Extract whichever and normalize
 *  to the dashed form Notion's API expects. */
export function extractNotionPageId(url: string): string | null {
  // Try undashed 32-hex first (most copy-paste Notion URLs)
  const undashed = url.match(/[0-9a-f]{32}/i)
  if (undashed) {
    const id = undashed[0].toLowerCase()
    return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`
  }
  // Try already-dashed
  const dashed = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return dashed ? dashed[0].toLowerCase() : null
}

/** Direct blocks-to-markdown renderer. Compared to the in-app DocBlock
 *  flattener (used by the Doc Hub UI), this collapses children inline
 *  with indentation so the downstream cowork pipeline reads it as a
 *  single Markdown document. */
function blocksToMarkdown(blocks: Array<NotionBlock & { _children?: NotionBlock[] }>, depth = 0): string {
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  const rt = (runs: NotionRichText[] | undefined): string => runs ? richTextToMarkdown(runs) : ''

  for (const b of blocks) {
    switch (b.type) {
      case 'paragraph':
        lines.push(`${indent}${rt(b.paragraph?.rich_text)}`)
        break
      case 'heading_1':
        lines.push(`${indent}# ${rt(b.heading_1?.rich_text)}`)
        break
      case 'heading_2':
        lines.push(`${indent}## ${rt(b.heading_2?.rich_text)}`)
        break
      case 'heading_3':
        lines.push(`${indent}### ${rt(b.heading_3?.rich_text)}`)
        break
      case 'bulleted_list_item':
        lines.push(`${indent}- ${rt(b.bulleted_list_item?.rich_text)}`)
        break
      case 'numbered_list_item':
        lines.push(`${indent}1. ${rt(b.numbered_list_item?.rich_text)}`)
        break
      case 'to_do':
        lines.push(`${indent}- [${b.to_do?.checked ? 'x' : ' '}] ${rt(b.to_do?.rich_text)}`)
        break
      case 'toggle':
        lines.push(`${indent}▸ ${rt(b.toggle?.rich_text)}`)
        break
      case 'callout':
        lines.push(`${indent}> ${b.callout?.icon?.emoji ?? '💡'} ${rt(b.callout?.rich_text)}`)
        break
      case 'quote':
        lines.push(`${indent}> ${rt(b.quote?.rich_text)}`)
        break
      case 'code':
        lines.push(`${indent}\`\`\`${b.code?.language ?? ''}`)
        lines.push(rt(b.code?.rich_text))
        lines.push(`${indent}\`\`\``)
        break
      case 'divider':
        lines.push(`${indent}---`)
        break
      case 'image': {
        const url = b.image?.external?.url ?? b.image?.file?.url ?? null
        if (url) lines.push(`${indent}![image](${url})`)
        break
      }
      case 'bookmark':
      case 'embed':
      case 'link_preview': {
        const url = b.bookmark?.url ?? b.embed?.url ?? b.link_preview?.url ?? null
        if (url) lines.push(`${indent}[${url}](${url})`)
        break
      }
      case 'table_row': {
        const cells = (b.table_row?.cells ?? []).map(c => rt(c)).join(' | ')
        lines.push(`${indent}| ${cells} |`)
        break
      }
      case 'child_page':
        lines.push(`${indent}_(subpage: ${b.child_page?.title ?? 'untitled'})_`)
        break
      case 'column_list':
      case 'column':
      case 'synced_block':
      case 'table':
        // Transparent — fall through to children below.
        break
      default:
        if (!b._children?.length) lines.push(`${indent}_[${b.type} block]_`)
        break
    }
    if (b._children?.length) {
      lines.push(blocksToMarkdown(b._children, b.type === 'column_list' || b.type === 'column' || b.type === 'synced_block' ? depth : depth + 1))
    }
  }
  return lines.join('\n')
}

/** Read the title rich-text out of a Notion page's properties. We don't
 *  know which property is the title (varies by database), so scan for
 *  the one whose type is 'title'. */
function extractPageTitle(page: { properties?: Record<string, { type?: string; title?: NotionRichText[] }> }): string {
  const props = page.properties ?? {}
  for (const [, value] of Object.entries(props)) {
    if (value?.type === 'title' && Array.isArray(value.title)) {
      return richTextToMarkdown(value.title).trim() || 'Untitled'
    }
  }
  return 'Untitled'
}

export async function syncIntakeDocFromNotion(args: SyncIntakeDocArgs): Promise<SyncIntakeDocResult> {
  const { projectId, notionUrl, category, uploadedBy } = args

  const pageId = extractNotionPageId(notionUrl)
  if (!pageId) {
    throw new Error(`Could not extract a Notion page ID from URL: ${notionUrl}`)
  }

  // Pull page + nested blocks in parallel. Depth 3 mirrors get-doc-content
  // so column-list + toggle-inside-callout nesting still loads its leaves.
  const [page, blocks] = await Promise.all([
    fetchPage(pageId),
    listBlockChildrenAll(pageId, 3),
  ])

  const title = extractPageTitle(page as { properties?: Record<string, { type?: string; title?: NotionRichText[] }> })
  const lastEditedAt = (page as { last_edited_time?: string }).last_edited_time ?? null
  const databaseId = (page as { parent?: { database_id?: string } }).parent?.database_id ?? null

  const headerLines = [
    `# ${title}`,
    '',
    `_Synced from Notion — page ${pageId}_`,
    lastEditedAt ? `_Last edited in Notion: ${lastEditedAt}_` : null,
    '',
    '---',
    '',
  ].filter(Boolean).join('\n')
  const markdown = headerLines + blocksToMarkdown(blocks as Array<NotionBlock & { _children?: NotionBlock[] }>)
  const markdownBytes = new TextEncoder().encode(markdown).byteLength

  // Stable filename per page so re-syncs overwrite in place.
  const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled'
  const filename = `notion-${safeTitle}-${pageId.slice(0,8)}.md`
  const storagePath = `web-intake/${projectId}/${category}/${filename}`

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  // Upload (upsert = true so re-sync replaces the file)
  const { error: uploadErr } = await sb.storage
    .from(INTAKE_BUCKET)
    .upload(storagePath, new Blob([markdown], { type: 'text/markdown' }), {
      contentType: 'text/markdown',
      upsert: true,
    })
  if (uploadErr) {
    throw new Error(`storage upload failed: ${uploadErr.message}`)
  }

  const { data: pub } = sb.storage.from(INTAKE_BUCKET).getPublicUrl(storagePath)

  const now = new Date().toISOString()

  // Upsert the intake doc row. (web_project_id, notion_page_id) is unique
  // (per the v101 migration's partial index), so we look up first to
  // decide insert-vs-update.
  const { data: existing } = await sb
    .from('web_intake_documents')
    .select('id')
    .eq('web_project_id', projectId)
    .eq('notion_page_id', pageId)
    .maybeSingle()

  const docRow = {
    web_project_id:        projectId,
    category,
    filename,
    storage_path:          storagePath,
    storage_url:           pub.publicUrl,
    file_size_bytes:       markdownBytes,
    mime_type:             'text/markdown',
    uploaded_by_employee_id: uploadedBy ?? null,
    notion_page_id:        pageId,
    notion_database_id:    databaseId,
    notion_synced_at:      now,
    notion_last_edited_at: lastEditedAt,
    archived:              false,
    parsed_at:             null,
    parsed_destination:    null,
    parsed_rows_count:     null,
    parse_error:           null,
  }

  let documentId: string
  if (existing?.id) {
    const { error: updErr } = await sb
      .from('web_intake_documents')
      .update(docRow)
      .eq('id', (existing as { id: string }).id)
    if (updErr) throw new Error(`intake doc update failed: ${updErr.message}`)
    documentId = (existing as { id: string }).id
  } else {
    const { data: inserted, error: insErr } = await sb
      .from('web_intake_documents')
      .insert({ ...docRow, uploaded_at: now })
      .select('id')
      .maybeSingle()
    if (insErr || !inserted) throw new Error(`intake doc insert failed: ${insErr?.message ?? 'no row returned'}`)
    documentId = (inserted as { id: string }).id
  }

  return {
    ok:                    true,
    document_id:           documentId,
    notion_page_id:        pageId,
    storage_path:          storagePath,
    notion_synced_at:      now,
    notion_last_edited_at: lastEditedAt,
    markdown_bytes:        markdownBytes,
  }
}
