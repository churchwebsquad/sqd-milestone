import { cached, TTL } from '../cache.ts'
import { queryDatabaseAll } from '../notion.ts'
import { pageToInitiative, pageToMilestone, pageToProgress } from '../parsers.ts'
import type { FeedItem, MilestoneEvent, ProgressFeedEntry } from '../types.ts'
import { DB } from './data-sources.ts'

interface ListProgressArgs {
  limit?: number
  sinceISO?: string
  initiativeId?: string
}

/**
 * Cross-initiative merged feed of narrative progress entries and
 * milestone-complete events. Events are synthesized from the Milestones DB
 * at read time — they never exist as rows in the Progress DB itself.
 */
export async function listProgress(args: ListProgressArgs = {}): Promise<FeedItem[]> {
  const [progPages, milePages, initPages] = await Promise.all([
    cached('progress:raw', TTL.progress, () => queryDatabaseAll(DB.PROGRESS)),
    cached('milestones:raw', TTL.milestones, () => queryDatabaseAll(DB.MILESTONES)),
    cached('initiatives:raw', TTL.initiatives, () => queryDatabaseAll(DB.INITIATIVES)),
  ])
  const initiatives = initPages.map(pageToInitiative)
  const initNameById = new Map(initiatives.map(i => [i.id, i.name]))
  const initDeptById = new Map(initiatives.map(i => [i.id, i.department]))

  // Build a milestone-name lookup so progress entries can carry the
  // resolved Action Item names (used for the "→ Action Item" chip on
  // the progress card). Single pass over the milestone list we already
  // fetched.
  const mileNameById = new Map<string, string>()
  for (const m of milePages) {
    const parsed = pageToMilestone(m)
    mileNameById.set(parsed.id, parsed.name)
  }

  // Progress entries
  const progEntries: ProgressFeedEntry[] = progPages.map(p => {
    const parsed = pageToProgress(p)
    parsed.initiativeName = parsed.initiativeId ? initNameById.get(parsed.initiativeId) ?? null : null
    parsed.department = parsed.department ?? (parsed.initiativeId ? initDeptById.get(parsed.initiativeId) ?? null : null)
    parsed.actionItemNames = parsed.actionItemIds.map(
      id => mileNameById.get(id) ?? 'Action Item',
    )
    return { kind: 'progress-entry', ...parsed }
  })

  // Milestone-complete events. A milestone with multiple parent
  // initiatives carries every parent in `initiativeIds` so the
  // initiative-filter below can match any of them.
  const mileEvents: MilestoneEvent[] = milePages
    .map(m => pageToMilestone(m))
    .filter(m => m.status === 'complete')
    .map<MilestoneEvent>(m => {
      const primaryId = m.initiativeIds[0] ?? null
      return {
        kind: 'milestone-event',
        id: m.id,
        milestoneName: m.name,
        initiativeId: primaryId,
        initiativeIds: m.initiativeIds,
        initiativeName: primaryId ? initNameById.get(primaryId) ?? null : null,
        department: m.department ?? (primaryId ? initDeptById.get(primaryId) ?? null : null),
        completedAt: m.targetDate, // Notion doesn't expose an edited-time at the property level; use target date
        notionUrl: m.notionUrl,
      }
    })

  // Filter by initiative if requested. For milestone events, match any
  // parent initiative so a multi-linked Action Item shows on each
  // parent's feed. Progress entries still match on the single
  // initiativeId — they have one canonical parent.
  const filtered: FeedItem[] = [...progEntries, ...mileEvents].filter(item => {
    if (args.initiativeId) {
      if (item.kind === 'milestone-event') {
        if (!item.initiativeIds.includes(args.initiativeId)) return false
      } else if (item.initiativeId !== args.initiativeId) {
        return false
      }
    }
    const when = item.kind === 'progress-entry' ? item.datePosted : item.completedAt
    if (args.sinceISO && when && when < args.sinceISO) return false
    return true
  })

  // Sort desc by date
  filtered.sort((a, b) => {
    const da = a.kind === 'progress-entry' ? a.datePosted : a.completedAt
    const db = b.kind === 'progress-entry' ? b.datePosted : b.completedAt
    return (db ?? '').localeCompare(da ?? '')
  })

  return args.limit ? filtered.slice(0, args.limit) : filtered
}
