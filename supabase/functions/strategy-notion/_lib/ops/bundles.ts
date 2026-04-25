import type { Initiative } from '../types.ts'
import { listInitiatives } from './list-initiatives.ts'
import { listMilestones } from './list-milestones.ts'
import { listProgress } from './list-progress.ts'
import { resolveNotionUserId } from './resolve-user.ts'

const DAY = 24 * 60 * 60 * 1000

function isPastOrToday(iso: string | null): boolean {
  if (!iso) return false
  const then = new Date(iso).getTime()
  const now = new Date().getTime()
  return then <= now
}

function withinNextWeek(iso: string | null): boolean {
  if (!iso) return false
  const then = new Date(iso).getTime()
  const now = new Date().getTime()
  return then >= now - DAY && then <= now + 7 * DAY
}

const ACTIVE_INITIATIVE_STATUSES = new Set(['proposed', 'scoping', 'in-progress', 'testing', 'blocked', 'in-review'])

/**
 * Command Center payload — the three attention-card counts + their preview
 * items, plus the active initiatives grid grouped by department on the
 * client.
 */
export async function commandCenterBundle() {
  const [initiatives, milestones, feed] = await Promise.all([
    listInitiatives(),
    listMilestones(),
    listProgress({ limit: 6 }),
  ])

  const recentProgress = feed.filter(f => f.kind === 'progress-entry').slice(0, 3)
  const milestonesThisWeek = milestones
    .filter(m => m.status !== 'complete' && withinNextWeek(m.targetDate))
    .sort((a, b) => (a.targetDate ?? '').localeCompare(b.targetDate ?? ''))
  const needsCheckIn = initiatives
    .filter(i => isPastOrToday(i.nextCheckInDue) && i.status !== 'launched' && i.status !== 'paused' && i.status !== 'archived')
    .sort((a, b) => (a.nextCheckInDue ?? '').localeCompare(b.nextCheckInDue ?? ''))

  const activeInitiatives = initiatives.filter(i => !i.status || ACTIVE_INITIATIVE_STATUSES.has(i.status))

  return {
    stats: {
      recentProgressCount: feed.filter(f => f.kind === 'progress-entry').length,
      milestonesThisWeekCount: milestonesThisWeek.length,
      needsCheckInCount: needsCheckIn.length,
      recentProgressPreview: recentProgress,
      milestonesThisWeekPreview: milestonesThisWeek.slice(0, 3),
      needsCheckInPreview: needsCheckIn.slice(0, 3),
    },
    activeInitiatives,
  }
}

/**
 * My Dashboard strategy stats + recent feed. Resolves the authenticated
 * user's email to a Notion user id on the server — don't trust a
 * client-supplied email in the body.
 */
export async function myDashboardBundle(email: string | null) {
  const [initiatives, feed, notionUserId] = await Promise.all([
    listInitiatives(),
    listProgress({ limit: 6 }),
    resolveNotionUserId(email),
  ])

  const needsCheckIn = initiatives.filter(i =>
    isPastOrToday(i.nextCheckInDue) &&
    i.status !== 'launched' && i.status !== 'paused' && i.status !== 'archived'
  )
  const mine = notionUserId
    ? initiatives.filter(i => i.owner?.id === notionUserId)
    : []
  // Per-user "needs check-in" — initiatives the caller owns that are overdue.
  // The dashboard's "Initiative Check-Ins" tile uses this for non-VP staff;
  // VPs see the global `needsCheckInCount`.
  const myNeedsCheckIn = mine.filter(i =>
    isPastOrToday(i.nextCheckInDue) &&
    i.status !== 'launched' && i.status !== 'paused' && i.status !== 'archived'
  )

  return {
    stats: {
      needsCheckInCount: needsCheckIn.length,
      myNeedsCheckInCount: myNeedsCheckIn.length,
      yourInitiativesCount: mine.length,
      notionUserId,
    },
    recentFeed: feed,
  }
}
