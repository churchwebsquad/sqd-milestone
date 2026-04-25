import { cacheInvalidate } from '../cache.ts'
import { patchPage } from '../notion.ts'
import { pageToInitiative } from '../parsers.ts'
import { checkInPatch } from '../writers.ts'
import type { Initiative } from '../types.ts'
import { resolveNotionUserId } from './resolve-user.ts'

/** Stamp Last Checked On = today, Last Checked By = caller (resolved from
 *  email), and optionally Check-In Note. Sugar over `update-initiative`
 *  that bakes in the resolution + the today-date so callers don't have to. */
export async function markCheckIn(
  initiativeId: string,
  note: string | null,
  callerEmail: string | null,
): Promise<Initiative> {
  const userId = callerEmail ? await resolveNotionUserId(callerEmail) : null
  const page = await patchPage(initiativeId, checkInPatch(userId, note))
  cacheInvalidate('initiatives:')
  cacheInvalidate(`initiative:${initiativeId}`)
  return pageToInitiative(page)
}
