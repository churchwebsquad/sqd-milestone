import { cacheInvalidate } from '../cache.ts'
import { createPage } from '../notion.ts'
import { pageToProgress } from '../parsers.ts'
import { progressCreate } from '../writers.ts'
import type { ProgressEntry, ProgressCreate } from '../types.ts'
import { resolveNotionUserId } from './resolve-user.ts'

/** Create a Progress entry. The Author people-property is set server-side
 *  from the caller's email — never accepted from the request body.
 *
 *  Resilience: if the Progress DB doesn't have an `Action Items`
 *  relation property, Notion 400s the whole create call. The
 *  Action-Items linkage is purely optional; retry the create without
 *  it so the entry still lands. The user gets the entry; the
 *  cross-reference just isn't recorded until they add the property to
 *  the DB. */
export async function createProgress(input: ProgressCreate, callerEmail: string | null): Promise<ProgressEntry> {
  const authorId = callerEmail ? await resolveNotionUserId(callerEmail) : null
  let page
  try {
    page = await createPage(progressCreate(input, authorId))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Action Items') && msg.includes('not a property')) {
      console.warn('[create-progress] Progress DB has no "Action Items" relation property — retrying without action-item linkage')
      const stripped = { ...input, actionItemIds: undefined }
      page = await createPage(progressCreate(stripped, authorId))
    } else {
      throw err
    }
  }
  cacheInvalidate('progress:')
  cacheInvalidate(`progress-for:${input.initiativeId}`)
  return pageToProgress(page)
}
