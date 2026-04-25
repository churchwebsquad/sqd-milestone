import { cacheInvalidate } from '../cache.ts'
import { createPage, fetchPage } from '../notion.ts'
import { pageToMilestone } from '../parsers.ts'
import { milestoneCreate } from '../writers.ts'
import type { Milestone, MilestoneCreate } from '../types.ts'

/** Create a new Action Item in status `Proposed`, suggested by another
 *  Action Item. The Initiative is inferred from the suggesting parent so
 *  the caller doesn't have to pass it explicitly.
 *
 *  Notion-schema fallback: the database may not yet have the `Suggested By`
 *  or `Proposed` status option — both were called out in the Phase 2.5 brief
 *  as Ashley's responsibility. If either is missing, retry the create
 *  without the offending field and stash the provenance in Notes so the
 *  Initiative owner can still see who suggested it. */
export async function suggestActionItem(
  suggestedByPageId: string,
  input: { title: string; targetDate?: string | null; notes?: string | null },
): Promise<Milestone> {
  // Resolve the parent Action Item's Initiatives + name — we use the
  // name in the Notes-fallback when `Suggested By` doesn't exist.
  // Multi-initiative parents propagate every parent to the child so
  // the suggestion lives under each parent's roadmap.
  const parentPage = await fetchPage(suggestedByPageId)
  const parent = pageToMilestone(parentPage)
  if (parent.initiativeIds.length === 0) {
    throw new Error('Suggesting Action Item has no Initiative — cannot route the proposal.')
  }

  const baseInput: MilestoneCreate = {
    name: input.title,
    initiativeIds: parent.initiativeIds,
    status: 'proposed',
    suggestedById: suggestedByPageId,
    ...(input.targetDate ? { targetDate: input.targetDate } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  }

  const page = await tryCreateWithFallbacks(baseInput, parent.name, input.notes ?? null)

  cacheInvalidate('milestones:')
  for (const initId of parent.initiativeIds) {
    cacheInvalidate(`milestones-for:${initId}`)
    cacheInvalidate(`initiative:${initId}`)
  }
  return pageToMilestone(page)
}

async function tryCreateWithFallbacks(
  base: MilestoneCreate,
  parentName: string,
  originalNotes: string | null,
): Promise<ReturnType<typeof fetchPage> extends Promise<infer P> ? P : never> {
  const provenanceLine = `Suggested by [${parentName}]`
  const notesWithProvenance = originalNotes
    ? `${provenanceLine}\n\n${originalNotes}`
    : provenanceLine

  // Try 1: full payload (Suggested By relation + Proposed status).
  try {
    return await createPage(milestoneCreate(base))
  } catch (e) {
    const msg = errorMessage(e)
    if (!isNotionValidationError(msg)) throw e

    // Try 2: drop Suggested By if Notion says it doesn't exist.
    if (msg.includes('Suggested By')) {
      const { suggestedById: _drop, notes, ...rest } = base
      try {
        return await createPage(milestoneCreate({
          ...rest,
          notes: notes ?? notesWithProvenance,
        }))
      } catch (e2) {
        const msg2 = errorMessage(e2)
        // Try 3: Proposed status missing too — fall back to Not Started.
        if (isNotionValidationError(msg2) &&
            (msg2.includes('Proposed') || msg2.toLowerCase().includes('status'))) {
          const { status: _s, suggestedById: _s2, notes: _n, ...minimal } = base
          return await createPage(milestoneCreate({
            ...minimal,
            status: 'not-started',
            notes: notesWithProvenance,
          }))
        }
        throw e2
      }
    }

    // Try alt: Proposed status missing (but Suggested By exists).
    if (msg.includes('Proposed') || msg.toLowerCase().includes('status is expected')) {
      return await createPage(milestoneCreate({
        ...base,
        status: 'not-started',
        notes: notesWithProvenance,
      }))
    }

    throw e
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
function isNotionValidationError(msg: string): boolean {
  return msg.includes('400') || msg.includes('validation_error') || msg.includes('not a property that exists')
}
