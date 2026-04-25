import { cacheInvalidate } from '../cache.ts'
import { patchPage } from '../notion.ts'
import { pageToProgress } from '../parsers.ts'
import { progressPatch } from '../writers.ts'
import type { ProgressEntry, ProgressWritable } from '../types.ts'

export async function updateProgress(id: string, updates: ProgressWritable): Promise<ProgressEntry> {
  // Mirror the resilience in create-progress: retry without the
  // Action Items relation if the workspace's Progress DB doesn't have
  // that property. The relation is additive; the rest of the patch
  // should still apply.
  let page
  try {
    page = await patchPage(id, progressPatch(updates))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Action Items') && msg.includes('not a property') && updates.actionItemIds !== undefined) {
      console.warn('[update-progress] Progress DB has no "Action Items" relation property — retrying without action-item linkage')
      const { actionItemIds: _drop, ...rest } = updates
      page = await patchPage(id, progressPatch(rest))
    } else {
      throw err
    }
  }
  const entry = pageToProgress(page)
  cacheInvalidate('progress:')
  if (entry.initiativeId) {
    cacheInvalidate(`progress-for:${entry.initiativeId}`)
  }
  return entry
}
