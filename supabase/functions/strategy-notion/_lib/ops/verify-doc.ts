import { cacheInvalidate } from '../cache.ts'
import { patchPage } from '../notion.ts'
import { pageToDoc } from '../parsers.ts'
import { docPatch } from '../writers.ts'
import type { DocHubEntry } from '../types.ts'
import { resolveNotionUserId } from './resolve-user.ts'

/** Stamp a doc as Verified — sets Verification Status, Verified By (caller),
 *  Verified On (today). Sugar over `update-doc` with the trio bundled so
 *  the client doesn't have to know which fields together = "verified". */
export async function verifyDoc(id: string, callerEmail: string | null): Promise<DocHubEntry> {
  const userId = callerEmail ? await resolveNotionUserId(callerEmail) : null
  const today = new Date().toISOString().slice(0, 10)
  const page = await patchPage(id, docPatch({
    verificationStatus: 'verified',
    verifiedOn: today,
    ...(userId ? { verifiedBy: userId } : {}),
  }))
  cacheInvalidate('docs:')
  return pageToDoc(page)
}
