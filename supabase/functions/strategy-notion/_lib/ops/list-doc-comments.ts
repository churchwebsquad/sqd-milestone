import { cached, TTL } from '../cache.ts'
import { listPageComments, listUsersAll } from '../notion.ts'
import { richTextToMarkdown } from '../parsers.ts'

export interface DocCommentSummary {
  id: string
  text: string
  createdAt: string
  authorName: string | null
  authorId: string
}

/** Resolve Notion user IDs to a name lookup map. The Notion REST API
 *  returns the integration bot as the comment's `created_by` for any
 *  comment posted via the API — `listUsersAll` includes that bot, but
 *  the display name is "internal-integration" or similar. We resolve
 *  what we can; unresolved IDs render as "Unknown reviewer". */
async function buildUserNameIndex(): Promise<Map<string, string>> {
  return cached('user-names', TTL.userResolve, async () => {
    const users = await listUsersAll()
    const m = new Map<string, string>()
    for (const u of users) {
      if (u.name) m.set(u.id, u.name)
    }
    return m
  })
}

/** Comments for a single doc, newest first. Used by the doc detail page
 *  to surface VP / reviewer feedback above the body. Cached briefly so
 *  switching back-and-forth between queue and detail doesn't re-hit
 *  Notion every time. */
export async function listDocComments(docId: string): Promise<DocCommentSummary[]> {
  return cached(`doc-comments:${docId}`, TTL.initiativeDetail, async () => {
    const [comments, names] = await Promise.all([
      listPageComments(docId),
      buildUserNameIndex(),
    ])
    return comments
      .map(c => ({
        id: c.id,
        text: richTextToMarkdown(c.rich_text),
        createdAt: c.created_time,
        authorName: names.get(c.created_by.id) ?? null,
        authorId: c.created_by.id,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
}

/** Bulk variant — used by the Review Queue to render the most recent
 *  comment as a snippet on each row. Sequential calls (Notion's API
 *  doesn't have a bulk endpoint), but each is cached for the same TTL
 *  so subsequent navigation is instant. */
export async function listDocCommentsBulk(
  docIds: string[],
): Promise<Record<string, DocCommentSummary[]>> {
  const out: Record<string, DocCommentSummary[]> = {}
  // Sequential rather than Promise.all to be polite to Notion's rate
  // limit (3 req/s on free tier). Queue rows are typically < 20.
  for (const id of docIds) {
    try {
      out[id] = await listDocComments(id)
    } catch {
      out[id] = []
    }
  }
  return out
}
