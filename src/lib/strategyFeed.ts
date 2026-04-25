/**
 * Shared helpers for the Strategy Progress feed. The edge function already
 * merges progress entries with milestone-complete events (see
 * `list-progress.ts`), but the client occasionally needs to re-merge on
 * its own — e.g., when composing an initiative-detail feed from a
 * `getInitiativeDetail` response that returns the two arrays separately.
 */

import type { FeedItem, InitiativeDetailBundle, Milestone, MilestoneEvent, ProgressFeedEntry } from '../types/strategy'

/** Merge a detail bundle's milestones + progress into a single date-sorted
 *  feed. Milestone-complete events are synthesized client-side from the
 *  bundle's milestones array to match what the cross-initiative Progress
 *  page shows via the edge function. */
export function detailFeed(bundle: InitiativeDetailBundle): FeedItem[] {
  const entries: ProgressFeedEntry[] = bundle.progress.map(p => ({ kind: 'progress-entry', ...p }))
  const events: MilestoneEvent[] = bundle.milestones
    .filter(m => m.status === 'complete')
    .map(m => milestoneToEvent(m, bundle.initiative.name, bundle.initiative.department))
  return [...entries, ...events].sort(compareFeedDesc)
}

export function milestoneToEvent(m: Milestone, initiativeName: string | null, deptFallback: Milestone['department']): MilestoneEvent {
  return {
    kind: 'milestone-event',
    id: m.id,
    milestoneName: m.name,
    initiativeId: m.initiativeIds[0] ?? null,
    initiativeIds: m.initiativeIds,
    initiativeName: initiativeName ?? m.initiativeName,
    department: m.department ?? deptFallback,
    completedAt: m.targetDate,
    notionUrl: m.notionUrl,
  }
}

export function feedItemDate(item: FeedItem): string | null {
  return item.kind === 'progress-entry' ? item.datePosted : item.completedAt
}

export function compareFeedDesc(a: FeedItem, b: FeedItem): number {
  return (feedItemDate(b) ?? '').localeCompare(feedItemDate(a) ?? '')
}
