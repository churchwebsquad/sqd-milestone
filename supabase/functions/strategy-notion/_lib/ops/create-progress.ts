import { cacheInvalidate } from '../cache.ts'
import { createPage, patchPage } from '../notion.ts'
import { pageToProgress } from '../parsers.ts'
import { progressCreate, progressPatch } from '../writers.ts'
import type { ProgressEntry, ProgressCreate } from '../types.ts'
import { resolveNotionUserId } from './resolve-user.ts'

/** Match only the exact Notion validation error that fires when the
 *  `Action Items` relation property doesn't exist on the Progress DB.
 *  The previous regex (`'Action Items' && 'not a property'`) was too
 *  broad — any Notion error mentioning the property name in a
 *  sentence containing "not a property" silently stripped the
 *  linkage, which is how progress entries started losing their tie
 *  back to action items. Notion's actual phrasing is:
 *
 *    `<name> is not a property that exists.`
 *
 *  so we anchor on that. Anything else propagates so we can see it. */
const ACTION_ITEMS_NOT_A_PROPERTY =
  /Action Items\s+is\s+not\s+a\s+property\s+that\s+exists/i

/** Create a Progress entry. The Author people-property is set server-side
 *  from the caller's email — never accepted from the request body.
 *
 *  Defense in depth around the optional Action Items relation:
 *
 *  1. Tight catch — only retry-without-actionItemIds when the error
 *     is *specifically* "Action Items is not a property that exists".
 *     Any other failure surfaces, so a bad action-item id (or any
 *     other Notion error) doesn't silently drop the linkage.
 *  2. Verbose logging — every retry logs the original Notion error
 *     verbatim so we can debug live partners.
 *  3. Post-create verification — Notion has historically been quiet
 *     about ignoring unknown properties on `pages.create`. After the
 *     create succeeds we re-parse the returned page; if we asked for
 *     a linkage but Notion's response doesn't show it, we issue a
 *     follow-up `patchPage` to set the relation explicitly. This
 *     turns a silent loss into either a successful relation or a
 *     loud, traceable error. */
export async function createProgress(input: ProgressCreate, callerEmail: string | null): Promise<ProgressEntry> {
  const authorId = callerEmail ? await resolveNotionUserId(callerEmail) : null
  const requestedActionItemIds = input.actionItemIds ?? []
  const wantsLinkage = requestedActionItemIds.length > 0

  let page
  try {
    page = await createPage(progressCreate(input, authorId))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (ACTION_ITEMS_NOT_A_PROPERTY.test(msg)) {
      console.warn(
        '[create-progress] Progress DB has no "Action Items" relation property — '
        + 'retrying without action-item linkage. Original Notion error:',
        msg,
      )
      const stripped = { ...input, actionItemIds: undefined }
      page = await createPage(progressCreate(stripped, authorId))
    } else {
      console.error('[create-progress] Notion create failed:', msg)
      throw err
    }
  }

  // Post-create verification: if the caller asked to link this entry
  // to an action item, confirm Notion actually wrote the relation. If
  // not, attempt an explicit follow-up patch. Surfaces silent drops
  // instead of letting them through to the Progress feed unlinked.
  if (wantsLinkage) {
    let parsed = pageToProgress(page)
    const actuallyLinked = (parsed.actionItemIds ?? []).filter(id => requestedActionItemIds.includes(id))
    if (actuallyLinked.length !== requestedActionItemIds.length) {
      console.warn(
        '[create-progress] Action Items relation was not set by create — issuing follow-up patch. '
        + `wanted=${JSON.stringify(requestedActionItemIds)} got=${JSON.stringify(parsed.actionItemIds ?? [])}`,
      )
      try {
        const patched = await patchPage(parsed.id, progressPatch({ actionItemIds: requestedActionItemIds }))
        parsed = pageToProgress(patched)
      } catch (patchErr) {
        const msg = patchErr instanceof Error ? patchErr.message : String(patchErr)
        console.error('[create-progress] Follow-up patch for Action Items relation failed:', msg)
      }
    }
    cacheInvalidate('progress:')
    cacheInvalidate(`progress-for:${input.initiativeId}`)
    return parsed
  }

  cacheInvalidate('progress:')
  cacheInvalidate(`progress-for:${input.initiativeId}`)
  return pageToProgress(page)
}
