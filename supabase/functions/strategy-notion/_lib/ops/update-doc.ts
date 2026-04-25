import { cacheInvalidate } from '../cache.ts'
import { patchPage } from '../notion.ts'
import { pageToDoc } from '../parsers.ts'
import { docPatch } from '../writers.ts'
import type { DocHubEntry, DocWritable } from '../types.ts'

export async function updateDoc(id: string, updates: DocWritable): Promise<DocHubEntry> {
  const page = await patchPage(id, docPatch(updates))
  cacheInvalidate('docs:')
  return pageToDoc(page)
}
