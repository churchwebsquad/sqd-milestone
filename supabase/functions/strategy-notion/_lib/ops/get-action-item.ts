import { cached, TTL } from '../cache.ts'
import { fetchPage, listBlockChildrenAll, queryDatabaseAll } from '../notion.ts'
import { pageToInitiative, pageToMilestone, richTextToMarkdown } from '../parsers.ts'
import { flattenSharedBlock } from './get-doc-content.ts'
import { DB } from './data-sources.ts'
import type { DocBlock, Milestone, NotionRichText } from '../types.ts'

export interface ActionItemContent {
  actionItem: Milestone
  blocks: DocBlock[]
}

/** Fetch a single Action Item's metadata + body (Notion page blocks).
 *  Used by the Action Item detail page in the app. Briefly cached so a
 *  back-and-forth between the detail page and the Initiative doesn't
 *  re-hit Notion.
 *
 *  Initiative-name enrichment: the parser leaves `initiativeName: null`
 *  on a fresh page parse. Without this enrichment the Action Item
 *  detail page shows "Back to initiative" until the bundle's separate
 *  `getInitiativeDetail` call resolves the parent — visible flicker.
 *  We resolve the primary parent's name from the cached initiatives
 *  list (cheap; same query the rest of the app already populates). */
export async function getActionItemContent(id: string): Promise<ActionItemContent | null> {
  return cached(`action-item:${id}`, TTL.initiativeDetail, async () => {
    const [page, rawBlocks] = await Promise.all([
      fetchPage(id),
      // Mirror get-doc-content's depth bump (2 → 3) so multi-column /
      // synced-block / nested-toggle content on Action Items doesn't
      // get truncated mid-tree.
      listBlockChildrenAll(id, 3),
    ])
    const actionItem = pageToMilestone(page)
    const primaryInitiativeId = actionItem.initiativeIds[0] ?? null
    if (primaryInitiativeId) {
      const initPages = await cached(
        'initiatives:raw',
        TTL.initiatives,
        () => queryDatabaseAll(DB.INITIATIVES),
      )
      const parent = initPages.find(p => p.id === primaryInitiativeId)
      if (parent) {
        const parsed = pageToInitiative(parent)
        actionItem.initiativeName = parsed.name
        actionItem.department = actionItem.department ?? parsed.department
      }
    }
    return {
      actionItem,
      blocks: rawBlocks.map(flattenBlock).filter((b): b is DocBlock => !!b),
    }
  })
}

function rt(runs: NotionRichText[] | undefined): string {
  return runs ? richTextToMarkdown(runs) : ''
}

const flattenBlock = (b: Parameters<typeof flattenSharedBlock>[0]) => flattenSharedBlock(b, rt)
