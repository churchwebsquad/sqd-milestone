import { cached, TTL } from '../cache.ts'
import { queryDatabaseAll } from '../notion.ts'
import { pageToDoc } from '../parsers.ts'
import type { DocHubEntry } from '../types.ts'
import { DB } from './data-sources.ts'

export async function listDocs(): Promise<DocHubEntry[]> {
  const pages = await cached('docs:raw', TTL.docs, () => queryDatabaseAll(DB.DOC_HUB))
  return pages.map(pageToDoc).sort((a, b) => {
    const g = (a.group ?? '').localeCompare(b.group ?? '')
    if (g !== 0) return g
    return a.title.localeCompare(b.title)
  })
}
