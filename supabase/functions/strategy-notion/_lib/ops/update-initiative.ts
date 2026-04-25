import { cacheInvalidate } from '../cache.ts'
import { patchPage } from '../notion.ts'
import { pageToInitiative } from '../parsers.ts'
import { initiativePatch } from '../writers.ts'
import type { Initiative, InitiativeWritable } from '../types.ts'

/** PATCH an initiative page, then invalidate caches that referenced it.
 *  The returned page is re-parsed so the caller gets the canonical fresh
 *  shape without a follow-up read. */
export async function updateInitiative(id: string, updates: InitiativeWritable): Promise<Initiative> {
  const page = await patchPage(id, initiativePatch(updates))
  cacheInvalidate('initiatives:')
  cacheInvalidate(`initiative:${id}`)
  return pageToInitiative(page)
}
