import { cached, TTL } from '../cache.ts'
import { queryDatabaseAll } from '../notion.ts'
import { pageToInitiative, pageToMilestone, pageToProgress } from '../parsers.ts'
import type { Initiative } from '../types.ts'
import { DB } from './data-sources.ts'

/**
 * Return every Initiative page with its aggregate fields filled in —
 * milestone counts, completion percentage, update count, last-progress-at.
 * Aggregates come from a single pass over the Milestones + Progress DBs,
 * both cached so Command Center + Initiatives views share the same fetch.
 */
export async function listInitiatives(): Promise<Initiative[]> {
  const [initPages, milePages, progPages] = await Promise.all([
    cached('initiatives:raw', TTL.initiatives, () => queryDatabaseAll(DB.INITIATIVES)),
    cached('milestones:raw', TTL.milestones, () => queryDatabaseAll(DB.MILESTONES)),
    cached('progress:raw',   TTL.progress,   () => queryDatabaseAll(DB.PROGRESS)),
  ])

  const initiatives = initPages.map(pageToInitiative)
  const nameById = new Map(initiatives.map(i => [i.id, i.name]))
  const milestones = milePages.map(m => {
    const parsed = pageToMilestone(m)
    const primaryId = parsed.initiativeIds[0] ?? null
    parsed.initiativeName = primaryId ? nameById.get(primaryId) ?? null : null
    return parsed
  })
  const progress = progPages.map(p => {
    const parsed = pageToProgress(p)
    parsed.initiativeName = parsed.initiativeId ? nameById.get(parsed.initiativeId) ?? null : null
    return parsed
  })

  // Aggregate per initiative. Multi-initiative milestones count toward
  // each parent's totals (a shared Action Item is "in flight" for both
  // initiatives — counting it once each is the right intuition for the
  // completion-percent rollup).
  const milestoneStats = new Map<string, { total: number; complete: number }>()
  for (const m of milestones) {
    for (const initId of m.initiativeIds) {
      const prev = milestoneStats.get(initId) ?? { total: 0, complete: 0 }
      prev.total++
      if (m.status === 'complete') prev.complete++
      milestoneStats.set(initId, prev)
    }
  }
  const progressStats = new Map<string, { count: number; latest: string | null }>()
  for (const p of progress) {
    if (!p.initiativeId) continue
    const prev = progressStats.get(p.initiativeId) ?? { count: 0, latest: null }
    prev.count++
    if (p.datePosted && (!prev.latest || p.datePosted > prev.latest)) {
      prev.latest = p.datePosted
    }
    progressStats.set(p.initiativeId, prev)
  }

  for (const i of initiatives) {
    const m = milestoneStats.get(i.id) ?? { total: 0, complete: 0 }
    i.milestoneTotalCount = m.total
    i.milestoneCompletedCount = m.complete
    i.milestoneCompletionPct = m.total > 0 ? Math.round((m.complete / m.total) * 100) : null

    const p = progressStats.get(i.id) ?? { count: 0, latest: null }
    i.updateCount = p.count
    i.lastProgressAt = p.latest
  }

  return initiatives
}
