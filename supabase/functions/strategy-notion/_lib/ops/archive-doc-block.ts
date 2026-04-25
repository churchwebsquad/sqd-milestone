import { cacheInvalidate } from '../cache.ts'
import { patchBlock } from '../notion.ts'

/** Soft-delete a block via Notion's `archived: true` flag — same primitive
 *  used for archiving pages. Notion treats archived blocks as removed in
 *  the UI; the Notion-side undo/restore lives in the page's history. */
export async function archiveDocBlock(
  docId: string,
  blockId: string,
): Promise<{ ok: true }> {
  await patchBlock(blockId, { archived: true })
  cacheInvalidate(`doc-content:${docId}`)
  cacheInvalidate(`action-item:${docId}`)
  cacheInvalidate(`initiative-blocks:${docId}`)
  cacheInvalidate(`initiative:${docId}`)
  cacheInvalidate('docs:')
  cacheInvalidate('milestones:')
  return { ok: true }
}
