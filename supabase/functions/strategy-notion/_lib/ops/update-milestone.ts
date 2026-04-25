import { cacheInvalidate } from '../cache.ts'
import { patchPage } from '../notion.ts'
import { pageToMilestone } from '../parsers.ts'
import { milestonePatch } from '../writers.ts'
import type { Milestone, MilestoneWritable } from '../types.ts'

export async function updateMilestone(id: string, updates: MilestoneWritable): Promise<Milestone> {
  const page = await patchPage(id, milestonePatch(updates))
  const ms = pageToMilestone(page)
  cacheInvalidate('milestones:')
  // Invalidate every parent initiative's per-initiative caches. When
  // the relation itself was changed, both old and new parents need to
  // be cleared — but we only see the *new* parents on the post-patch
  // page. The old parent's bundle becomes momentarily stale until its
  // own TTL expires; an acceptable trade for not having to read the
  // before-state on every update.
  for (const initId of ms.initiativeIds) {
    cacheInvalidate(`milestones-for:${initId}`)
    cacheInvalidate(`initiative:${initId}`)
  }
  return ms
}
