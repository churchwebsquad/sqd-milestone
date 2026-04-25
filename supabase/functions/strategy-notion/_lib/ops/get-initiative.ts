import { cached, TTL } from '../cache.ts'
import { listBlockChildrenAll, queryDatabaseAll } from '../notion.ts'
import { pageToInitiative, pageToMilestone, pageToProgress, richTextToMarkdown } from '../parsers.ts'
import type { DocBlock, Initiative, InitiativeDetailBundle, Milestone, NotionRichText, ProgressEntry } from '../types.ts'
import { DB } from './data-sources.ts'
import { flattenSharedBlock } from './get-doc-content.ts'

// Local alias — the shared types.ts doesn't define a bundle type yet and
// we can add it later. For now build inline.
interface InitiativeDetailBundle {
  initiative: Initiative
  milestones: Milestone[]
  progress: ProgressEntry[]
  blocks: DocBlock[]
}

/**
 * Fetch one initiative + its milestones + its progress entries.
 * Filters are done at the Notion query level when possible to minimize
 * returned pages.
 *
 * Progress fetch covers BOTH the direct initiative-relation AND any
 * progress entries linked via the Action Items relation to one of this
 * initiative's milestones. That second path matters for the per-Action
 * Item progress feed: if a progress entry is tagged with an Action
 * Item but its own Initiative relation is empty (or set to a different
 * parent of a multi-linked Action Item), the entry would otherwise
 * never appear on the Action Item detail page. Sequencing the progress
 * fetch *after* milestones gives us their IDs to fold into the OR
 * filter.
 */
export async function getInitiative(id: string): Promise<InitiativeDetailBundle | null> {
  const [initPages, milePages, rawBlocks] = await Promise.all([
    cached(`initiative:${id}`, TTL.initiativeDetail, () => queryDatabaseAll(DB.INITIATIVES, {
      filter: { property: 'ID', rich_text: { equals: id } }, // may 400 if property doesn't exist
    }).catch(async () => {
      // Fallback: load all and filter client-side (fine for ~dozens of initiatives)
      return (await cached('initiatives:raw', TTL.initiatives, () => queryDatabaseAll(DB.INITIATIVES)))
        .filter(p => p.id === id)
    })),
    cached(`milestones-for:${id}`, TTL.initiativeDetail, () => queryDatabaseAll(DB.MILESTONES, {
      filter: { property: 'Initiative', relation: { contains: id } },
    })),
    // Body blocks for the initiative page — populates the "Additional
    // Info" section on the detail page. Same flatten path the Doc Hub
    // and Action Item content use, so the in-app block editor lights
    // up against initiative pages with no extra glue.
    cached(`initiative-blocks:${id}`, TTL.initiativeDetail, () => listBlockChildrenAll(id, 3)),
  ])

  const page = initPages.find(p => p.id === id)
  if (!page) return null

  // Build the filter: progress entries whose Initiative relation
  // contains this id, OR whose Action Items relation contains any of
  // this initiative's milestone ids. The Action-Items branch is what
  // lets the per-Action-Item progress feed surface entries that were
  // tagged with the Action Item but whose own Initiative relation is
  // empty / different.
  //
  // Resilience: not every Notion workspace has the `Action Items`
  // relation property on the Progress DB (it has to be added by the
  // user). When the property is missing Notion 400s the whole query.
  // Fall back to the simple Initiative-only filter on that error so
  // the page still loads — the OR-branch is purely additive.
  const milestoneIds = milePages.map(p => p.id)
  const baseFilter = { property: 'Initiative', relation: { contains: id } }
  const progPages = await cached(
    `progress-for:${id}`,
    TTL.initiativeDetail,
    async () => {
      if (milestoneIds.length === 0) {
        return queryDatabaseAll(DB.PROGRESS, { filter: baseFilter })
      }
      const orFilter = {
        or: [
          baseFilter,
          ...milestoneIds.map(mId => ({
            property: 'Action Items', relation: { contains: mId },
          })),
        ],
      }
      try {
        return await queryDatabaseAll(DB.PROGRESS, { filter: orFilter })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('Could not find property') && msg.includes('Action Items')) {
          console.warn('[get-initiative] Progress DB has no "Action Items" relation property — falling back to Initiative-only filter')
          return queryDatabaseAll(DB.PROGRESS, { filter: baseFilter })
        }
        throw err
      }
    },
  )

  const initiative = pageToInitiative(page)
  const milestones = milePages
    .map(m => {
      const parsed = pageToMilestone(m)
      parsed.initiativeName = initiative.name
      parsed.department = parsed.department ?? initiative.department
      return parsed
    })
    .sort((a, b) => {
      // Order by explicit Order, then Target Date asc
      if (a.order != null && b.order != null) return a.order - b.order
      if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate)
      return 0
    })

  const milestoneNameById = new Map(milestones.map(m => [m.id, m.name]))
  const progress = progPages
    .map(p => {
      const parsed = pageToProgress(p)
      // The progress entry's primary initiative may not be this one
      // (it could be linked only via an Action Item). Only fill in
      // initiativeName / department from this initiative when the
      // entry's own initiativeId actually matches — otherwise leave
      // the parser's values intact so the chip on the entry shows the
      // entry's true parent.
      if (parsed.initiativeId === initiative.id) {
        parsed.initiativeName = initiative.name
        parsed.department = parsed.department ?? initiative.department
      }
      parsed.actionItemNames = parsed.actionItemIds.map(
        id => milestoneNameById.get(id) ?? 'Action Item',
      )
      return parsed
    })
    .sort((a, b) => (b.datePosted ?? '').localeCompare(a.datePosted ?? ''))

  // Fill aggregates on the initiative
  initiative.milestoneTotalCount = milestones.length
  initiative.milestoneCompletedCount = milestones.filter(m => m.status === 'complete').length
  initiative.milestoneCompletionPct = milestones.length > 0
    ? Math.round((initiative.milestoneCompletedCount / milestones.length) * 100)
    : null
  initiative.updateCount = progress.length
  initiative.lastProgressAt = progress[0]?.datePosted ?? null

  const blocks = rawBlocks
    .map(b => flattenSharedBlock(b, runs => richTextToMarkdown(runs as NotionRichText[] | undefined)))
    .filter((b): b is DocBlock => !!b)

  return { initiative, milestones, progress, blocks }
}
