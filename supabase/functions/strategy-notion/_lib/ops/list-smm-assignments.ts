// Fetch SMS Team Member assignments from the All-In Members database.
// Returns { member: number, smm: string }[] — one entry per church
// that has a non-cancelled SMM assigned.
// Database: collection://1f2e83f7-31f6-80f0-b787-000b47cfcde6

import { cached, TTL } from '../cache.ts'
import { queryDatabaseAll } from '../notion.ts'
import type { NotionPage } from '../types.ts'

const ALL_IN_MEMBERS_DB = '1f2e83f7-31f6-80f0-b787-000b47cfcde6'

export interface SmmAssignment {
  member: number
  smm:    string
}

export async function listSmmAssignments(): Promise<SmmAssignment[]> {
  return cached('smm:assignments', TTL.docs, async () => {
    const pages = await queryDatabaseAll(ALL_IN_MEMBERS_DB)
    const out: SmmAssignment[] = []

    for (const page of pages as NotionPage[]) {
      const props = page.properties as Record<string, any>
      const memberProp = props['Member #']
      const smmProp    = props['SMS Team Member']

      const member = memberProp?.number
      const smm    = smmProp?.select?.name ?? null

      if (!member || !smm || smm === 'Cancelled') continue
      out.push({ member: Number(member), smm })
    }

    return out
  })
}
