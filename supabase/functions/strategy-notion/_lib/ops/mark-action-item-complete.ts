import { cacheInvalidate } from '../cache.ts'
import { patchPage } from '../notion.ts'
import { pageToMilestone } from '../parsers.ts'
import { milestonePatch } from '../writers.ts'
import type { Milestone } from '../types.ts'

/** Notion's 400 when a property doesn't exist on the target DB. We
 *  match the exact phrasing so we only fall back when it's truly the
 *  Completion Date property that's missing — anything else (auth,
 *  status enum drift, etc.) propagates so we can see it. */
const COMPLETION_DATE_NOT_A_PROPERTY =
  /Completion Date\s+is\s+not\s+a\s+property\s+that\s+exists/i

/** Sugar over `update-milestone` that flips status → Complete and stamps
 *  Completion Date = today.
 *
 *  Earlier comment claimed the Completion Date write was "silently
 *  ignored by Notion if the property doesn't exist." That's wrong —
 *  Notion 400s the whole patch, so the status flip never happens
 *  either. Workspaces without the column were unable to mark
 *  anything complete.
 *
 *  Behavior now: try the combined patch (status + completionDate). If
 *  Notion returns the specific "Completion Date is not a property"
 *  validation error, retry with just the status flip — staff still
 *  get the state change, the date stamp just isn't recorded until
 *  the property is added. Other errors surface verbatim. */
export async function markActionItemComplete(id: string): Promise<Milestone> {
  const today = new Date().toISOString().slice(0, 10)
  let page
  try {
    page = await patchPage(id, milestonePatch({
      status: 'complete',
      completionDate: today,
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (COMPLETION_DATE_NOT_A_PROPERTY.test(msg)) {
      console.warn(
        '[mark-action-item-complete] Milestones DB has no "Completion Date" property — '
        + 'retrying with status only. Original Notion error:',
        msg,
      )
      page = await patchPage(id, milestonePatch({ status: 'complete' }))
    } else {
      console.error('[mark-action-item-complete] Notion patch failed:', msg)
      throw err
    }
  }
  const ms = pageToMilestone(page)
  cacheInvalidate('milestones:')
  for (const initId of ms.initiativeIds) {
    cacheInvalidate(`milestones-for:${initId}`)
    cacheInvalidate(`initiative:${initId}`)
  }
  return ms
}
