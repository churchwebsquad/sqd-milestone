import { cacheInvalidate } from '../cache.ts'
import { fetchPage, patchPage } from '../notion.ts'
import { pageToMilestone, pageToProgress } from '../parsers.ts'
import { archivePatch } from '../writers.ts'
import type { StrategyEntity } from '../types.ts'

/** Archive (soft-delete) a Notion page. We don't expose hard-delete because
 *  Notion's REST API doesn't either. Cache invalidation depends on the
 *  entity kind — milestones/progress need their parent initiative looked up
 *  beforehand so we can clear the per-initiative caches too. */
export async function archivePage(id: string, entity: StrategyEntity): Promise<{ ok: true }> {
  // For milestone/progress we need the parent initiative(s) so the
  // initiative-detail cache can be invalidated. Read the page first
  // (cheap, ~one round-trip) before archiving. Milestones can have
  // multiple parents — clear all of them.
  let parentInitiativeIds: string[] = []
  if (entity === 'milestone') {
    const page = await fetchPage(id)
    parentInitiativeIds = pageToMilestone(page).initiativeIds
  } else if (entity === 'progress') {
    const page = await fetchPage(id)
    const pid = pageToProgress(page).initiativeId
    parentInitiativeIds = pid ? [pid] : []
  }

  await patchPage(id, archivePatch())

  switch (entity) {
    case 'initiative':
      cacheInvalidate('initiatives:')
      cacheInvalidate(`initiative:${id}`)
      break
    case 'milestone':
      cacheInvalidate('milestones:')
      for (const pid of parentInitiativeIds) {
        cacheInvalidate(`milestones-for:${pid}`)
        cacheInvalidate(`initiative:${pid}`)
      }
      break
    case 'progress':
      cacheInvalidate('progress:')
      for (const pid of parentInitiativeIds) cacheInvalidate(`progress-for:${pid}`)
      break
    case 'doc':
      cacheInvalidate('docs:')
      break
  }

  return { ok: true }
}
