import { cacheInvalidate } from '../cache.ts'
import { patchPage } from '../notion.ts'
import { pageToMilestone } from '../parsers.ts'
import { milestonePatch } from '../writers.ts'
import type { Milestone } from '../types.ts'

/** Sugar over `update-milestone` that flips status → Complete and stamps
 *  Completion Date = today. The `Completion Date` write is silently
 *  ignored by Notion if the property doesn't exist yet, so this is safe
 *  to call even before Ashley adds the property to the schema. */
export async function markActionItemComplete(id: string): Promise<Milestone> {
  const today = new Date().toISOString().slice(0, 10)
  const page = await patchPage(id, milestonePatch({
    status: 'complete',
    completionDate: today,
  }))
  const ms = pageToMilestone(page)
  cacheInvalidate('milestones:')
  for (const initId of ms.initiativeIds) {
    cacheInvalidate(`milestones-for:${initId}`)
    cacheInvalidate(`initiative:${initId}`)
  }
  return ms
}
