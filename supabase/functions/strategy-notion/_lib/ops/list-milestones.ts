import { cached, TTL } from '../cache.ts'
import { queryDatabaseAll } from '../notion.ts'
import { pageToInitiative, pageToMilestone } from '../parsers.ts'
import type { Milestone } from '../types.ts'
import { DB } from './data-sources.ts'

export async function listMilestones(): Promise<Milestone[]> {
  const [milePages, initPages] = await Promise.all([
    cached('milestones:raw', TTL.milestones, () => queryDatabaseAll(DB.MILESTONES)),
    cached('initiatives:raw', TTL.initiatives, () => queryDatabaseAll(DB.INITIATIVES)),
  ])
  const initiatives = initPages.map(pageToInitiative)
  const initNameById = new Map(initiatives.map(i => [i.id, i.name]))
  const initDeptById = new Map(initiatives.map(i => [i.id, i.department]))
  return milePages.map(page => {
    const m = pageToMilestone(page)
    const primaryId = m.initiativeIds[0] ?? null
    if (primaryId) {
      m.initiativeName = initNameById.get(primaryId) ?? null
      // Milestone Department in Notion is a rollup of Initiative.Department,
      // but parsing rollups is painful — read from the (primary) initiative
      // directly. Multi-initiative items still get a single department; for
      // display we treat the first parent as canonical.
      m.department = m.department ?? initDeptById.get(primaryId) ?? null
    }
    return m
  })
}
