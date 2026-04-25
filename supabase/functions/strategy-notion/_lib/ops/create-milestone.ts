import { cacheInvalidate } from '../cache.ts'
import { createPage } from '../notion.ts'
import { pageToMilestone } from '../parsers.ts'
import { milestoneCreate } from '../writers.ts'
import type { Milestone, MilestoneCreate } from '../types.ts'

export async function createMilestone(input: MilestoneCreate): Promise<Milestone> {
  const page = await createPage(milestoneCreate(input))
  cacheInvalidate('milestones:')
  for (const initId of input.initiativeIds) {
    cacheInvalidate(`milestones-for:${initId}`)
    cacheInvalidate(`initiative:${initId}`)
  }
  return pageToMilestone(page)
}
