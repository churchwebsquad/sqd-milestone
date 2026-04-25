import { cacheInvalidate } from '../cache.ts'
import { patchPage } from '../notion.ts'
import { pageToMilestone } from '../parsers.ts'
import { milestonePatch } from '../writers.ts'
import type { Milestone } from '../types.ts'

/** Promote a Proposed Action Item to Not Started — the Initiative owner's
 *  signal that the suggestion is real work going forward. Bumps Order to
 *  the bottom of the active list so it doesn't disrupt sequencing. */
export async function promoteActionItem(
  id: string,
  nextOrder: number,
): Promise<Milestone> {
  const page = await patchPage(id, milestonePatch({
    status: 'not-started',
    order: nextOrder,
  }))
  const ms = pageToMilestone(page)
  cacheInvalidate('milestones:')
  for (const initId of ms.initiativeIds) {
    cacheInvalidate(`milestones-for:${initId}`)
    cacheInvalidate(`initiative:${initId}`)
  }
  return ms
}
