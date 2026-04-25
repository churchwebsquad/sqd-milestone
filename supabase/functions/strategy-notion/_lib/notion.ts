// Hand-rolled Notion REST client for the `strategy-notion` edge function.
// We deliberately don't import `@notionhq/client` — Deno + npm compatibility
// is a tax for a surface area this small (4 endpoints). Matches the pattern
// used elsewhere (e.g. `send-clickup-message` hand-rolls its ClickUp calls).

import type { NotionPage, NotionUser, NotionRichText } from './types.ts'

const NOTION_VERSION = '2022-06-28'
const API_BASE = 'https://api.notion.com/v1'

export class NotionSetupError extends Error {
  constructor(
    public missing: Array<'NOTION_TOKEN' | 'database-access' | 'write-capability'>,
    public detail?: string,
  ) {
    super(
      `Notion setup incomplete: ${missing.join(', ')}` +
      (detail ? ` (${detail})` : ''),
    )
    this.name = 'NotionSetupError'
  }
}

function token(): string {
  const t = Deno.env.get('NOTION_TOKEN')
  if (!t) throw new NotionSetupError(['NOTION_TOKEN'])
  return t
}

async function notionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  // Single retry on 429 honoring Retry-After — Notion free tier is ~3 req/s.
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') ?? '1')
    await new Promise(r => setTimeout(r, Math.max(retry, 1) * 1000))
    return notionFetch(path, init)
  }
  return res
}

/** Loop Notion's paginated query endpoint until `has_more` is false. */
export async function queryDatabaseAll(
  databaseId: string,
  body: Record<string, unknown> = {},
): Promise<NotionPage[]> {
  const pages: NotionPage[] = []
  let cursor: string | undefined = undefined
  let guard = 0
  do {
    const payload: Record<string, unknown> = { ...body, page_size: 100 }
    if (cursor) payload.start_cursor = cursor
    const res = await notionFetch(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 404 || res.status === 403) {
        throw new NotionSetupError(['database-access'], `db ${databaseId} → ${res.status}: ${text.slice(0, 200)}`)
      }
      throw new Error(`Notion query ${databaseId} ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = await res.json() as { results: NotionPage[]; next_cursor: string | null; has_more: boolean }
    pages.push(...data.results)
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined
    guard++
  } while (cursor && guard < 50)
  return pages
}

// ── Write helpers (Phase 2) ───────────────────────────────────────────────

/** Common write-error post-processing — maps Notion's `restricted_resource`
 *  403 to a `write-capability` setup error and 404/403 to `database-access`
 *  (mirrors the read path's wrapping in `queryDatabaseAll`). Throws on any
 *  non-2xx; returns the parsed page on success. */
async function handleWriteResponse(res: Response, ctx: string): Promise<NotionPage> {
  if (res.ok) {
    return await res.json() as NotionPage
  }
  const text = await res.text().catch(() => '')
  // Try to detect Notion's structured error code for capability denials.
  // The response body looks like `{"object":"error","code":"restricted_resource",...}`
  let code: string | null = null
  try {
    const parsed = JSON.parse(text) as { code?: string }
    code = parsed.code ?? null
  } catch {
    // ignore parse failure — fall back to generic mapping
  }
  if (code === 'restricted_resource') {
    throw new NotionSetupError(['write-capability'], `${ctx} → 403 restricted_resource`)
  }
  if (res.status === 404 || res.status === 403) {
    throw new NotionSetupError(['database-access'], `${ctx} → ${res.status}: ${text.slice(0, 200)}`)
  }
  throw new Error(`Notion ${ctx} ${res.status}: ${text.slice(0, 300)}`)
}

/** Patch an existing page's properties (or `archived` flag). */
export async function patchPage(pageId: string, body: Record<string, unknown>): Promise<NotionPage> {
  const res = await notionFetch(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return handleWriteResponse(res, `patch ${pageId}`)
}

/** Create a new page. `body` must include `parent` + `properties`. */
export async function createPage(body: Record<string, unknown>): Promise<NotionPage> {
  const res = await notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return handleWriteResponse(res, 'create page')
}

/** Fetch a single page by ID. Used by ops that need the parent initiative
 *  of a milestone for cache invalidation. */
export async function fetchPage(pageId: string): Promise<NotionPage> {
  const res = await notionFetch(`/pages/${pageId}`, { method: 'GET' })
  return handleWriteResponse(res, `fetch ${pageId}`)
}

/** Append child blocks to a page (used for "Request Changes" callouts). */
export async function appendBlockChildren(
  blockId: string,
  children: unknown[],
): Promise<void> {
  const res = await notionFetch(`/blocks/${blockId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 403) {
      const code = (() => { try { return (JSON.parse(text) as { code?: string }).code ?? null } catch { return null } })()
      if (code === 'restricted_resource') {
        throw new NotionSetupError(['write-capability'], `append-children ${blockId}`)
      }
    }
    throw new Error(`Notion append-children ${blockId} ${res.status}: ${text.slice(0, 300)}`)
  }
}

/** GET /v1/databases/{id} — full database schema (properties + options).
 *  Used by `sync-workflow-step-options` to read current multi-select
 *  option ids so the schema PATCH can preserve them while reconciling. */
export async function fetchDatabase(databaseId: string): Promise<NotionDatabase> {
  const res = await notionFetch(`/databases/${databaseId}`, { method: 'GET' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 404 || res.status === 403) {
      throw new NotionSetupError(['database-access'], `fetch-db ${databaseId} → ${res.status}: ${text.slice(0, 200)}`)
    }
    throw new Error(`Notion fetch-db ${databaseId} ${res.status}: ${text.slice(0, 300)}`)
  }
  return await res.json() as NotionDatabase
}

/** PATCH /v1/databases/{id} — update database schema. Used to reconcile
 *  the Workflow Step multi-select options with the milestone catalog. */
export async function patchDatabase(
  databaseId: string,
  body: Record<string, unknown>,
): Promise<NotionDatabase> {
  const res = await notionFetch(`/databases/${databaseId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 403) {
      const code = (() => { try { return (JSON.parse(text) as { code?: string }).code ?? null } catch { return null } })()
      if (code === 'restricted_resource') {
        throw new NotionSetupError(['write-capability'], `patch-db ${databaseId}`)
      }
    }
    throw new Error(`Notion patch-db ${databaseId} ${res.status}: ${text.slice(0, 400)}`)
  }
  return await res.json() as NotionDatabase
}

interface NotionMultiSelectOption {
  id?: string
  name: string
  color?: string
}

interface NotionMultiSelectProperty {
  type: 'multi_select'
  multi_select: { options: NotionMultiSelectOption[] }
}

interface NotionDatabase {
  id: string
  properties: Record<string, NotionMultiSelectProperty | { type: string }>
}

/** PATCH /v1/blocks/{id} — update or archive a single block. Used by the
 *  in-app body editor to update a paragraph's rich_text or to soft-delete
 *  an existing block. The body shape depends on the operation:
 *    - update: `{ <type>: { rich_text: [...] } }`
 *    - archive: `{ archived: true }` */
export async function patchBlock(
  blockId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await notionFetch(`/blocks/${blockId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 403) {
      const code = (() => { try { return (JSON.parse(text) as { code?: string }).code ?? null } catch { return null } })()
      if (code === 'restricted_resource') {
        throw new NotionSetupError(['write-capability'], `patch-block ${blockId}`)
      }
    }
    throw new Error(`Notion patch-block ${blockId} ${res.status}: ${text.slice(0, 300)}`)
  }
}

/** GET /v1/comments?block_id={page_id} — list comments on a Notion page.
 *  Returns at most 100 results (no pagination here — the queue and doc
 *  detail UI need only the most recent few; we slice on the client). */
export async function listPageComments(pageId: string): Promise<NotionComment[]> {
  const qs = new URLSearchParams({ block_id: pageId, page_size: '100' })
  const res = await notionFetch(`/comments?${qs.toString()}`, { method: 'GET' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 403) {
      const code = (() => { try { return (JSON.parse(text) as { code?: string }).code ?? null } catch { return null } })()
      if (code === 'restricted_resource') {
        // No "Read comments" capability — return empty rather than failing
        // the bulk op for every doc on the queue.
        return []
      }
    }
    throw new Error(`Notion list-comments ${pageId} ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json() as { results: NotionComment[] }
  return data.results ?? []
}

export interface NotionComment {
  id: string
  parent: { type: string; page_id?: string; block_id?: string }
  created_time: string
  created_by: { id: string }
  rich_text: NotionRichText[]
}

/** Post a top-level comment on a Notion page. Renders in Notion's
 *  comments side panel, the same place users discuss page content
 *  natively — exactly where the original author will look for review
 *  feedback. Requires the integration to have the "Insert comments"
 *  capability (separate from "Insert content"). */
export async function postPageComment(pageId: string, text: string): Promise<void> {
  const res = await notionFetch('/comments', {
    method: 'POST',
    body: JSON.stringify({
      parent: { page_id: pageId },
      rich_text: [{ type: 'text', text: { content: text } }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 403) {
      const code = (() => { try { return (JSON.parse(body) as { code?: string }).code ?? null } catch { return null } })()
      if (code === 'restricted_resource') {
        throw new NotionSetupError(['write-capability'], `post-comment ${pageId}`)
      }
    }
    throw new Error(`Notion post-comment ${pageId} ${res.status}: ${body.slice(0, 300)}`)
  }
}

interface NotionBlock {
  id: string
  type: string
  has_children: boolean
  paragraph?: { rich_text: NotionRichText[] }
  heading_1?: { rich_text: NotionRichText[] }
  heading_2?: { rich_text: NotionRichText[] }
  heading_3?: { rich_text: NotionRichText[] }
  bulleted_list_item?: { rich_text: NotionRichText[] }
  numbered_list_item?: { rich_text: NotionRichText[] }
  callout?: { rich_text: NotionRichText[]; icon?: { emoji?: string } }
  quote?: { rich_text: NotionRichText[] }
  code?: { rich_text: NotionRichText[]; language?: string }
  image?: { type: 'external' | 'file'; external?: { url: string }; file?: { url: string } }
  // Phase additions — render parity with Notion for the common block
  // shapes a doc author actually uses. Tables come back as a parent
  // `table` block with `table_row` children that each carry `cells`.
  to_do?: { rich_text: NotionRichText[]; checked?: boolean }
  toggle?: { rich_text: NotionRichText[] }
  bookmark?: { url: string; caption?: NotionRichText[] }
  embed?: { url: string }
  video?: { type: 'external' | 'file'; external?: { url: string }; file?: { url: string } }
  link_preview?: { url: string }
  table?: { table_width: number; has_column_header?: boolean; has_row_header?: boolean }
  table_row?: { cells: NotionRichText[][] }
  // Layout / synced / subpage blocks. We don't need their config — just
  // need TS to accept their existence so the flattener can match on
  // `type` and recurse into `_children`.
  column_list?: Record<string, unknown>
  column?: Record<string, unknown>
  synced_block?: Record<string, unknown>
  child_page?: { title?: string }
}

/** Recursively fetch a page's block tree (depth-limited to keep round-trips
 *  bounded). Returns raw Notion blocks; the caller flattens to `DocBlock[]`. */
export async function listBlockChildrenAll(
  blockId: string,
  depth = 3,
): Promise<NotionBlock[]> {
  const out: NotionBlock[] = []
  let cursor: string | undefined
  let guard = 0
  do {
    const qs = new URLSearchParams()
    qs.set('page_size', '100')
    if (cursor) qs.set('start_cursor', cursor)
    const res = await notionFetch(`/blocks/${blockId}/children?${qs.toString()}`, { method: 'GET' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Notion list-children ${blockId} ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = await res.json() as { results: NotionBlock[]; next_cursor: string | null; has_more: boolean }
    out.push(...data.results)
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined
    guard++
  } while (cursor && guard < 30)

  // Recurse into children when depth allows (1-2 levels is enough for
  // bulleted lists / nested callouts).
  if (depth > 0) {
    for (const b of out) {
      if (b.has_children) {
        ;(b as NotionBlock & { _children?: NotionBlock[] })._children =
          await listBlockChildrenAll(b.id, depth - 1)
      }
    }
  }
  return out
}

export type { NotionBlock }

export async function listUsersAll(): Promise<NotionUser[]> {
  const users: NotionUser[] = []
  let cursor: string | undefined
  let guard = 0
  do {
    const qs = new URLSearchParams()
    qs.set('page_size', '100')
    if (cursor) qs.set('start_cursor', cursor)
    const res = await notionFetch(`/users?${qs.toString()}`, { method: 'GET' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Notion list users ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = await res.json() as { results: NotionUser[]; next_cursor: string | null; has_more: boolean }
    users.push(...data.results)
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined
    guard++
  } while (cursor && guard < 10)
  return users
}
