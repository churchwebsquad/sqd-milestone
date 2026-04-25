import { cacheInvalidate } from '../cache.ts'
import { createPage } from '../notion.ts'
import { pageToInitiative } from '../parsers.ts'
import { initiativeCreate } from '../writers.ts'
import type { Initiative, InitiativeCreate } from '../types.ts'

export async function createInitiative(input: InitiativeCreate): Promise<Initiative> {
  const page = await createPage(initiativeCreate(input))
  cacheInvalidate('initiatives:')
  return pageToInitiative(page)
}
