/**
 * Stall detector — flag projects whose current signal hasn't moved
 * in N days, where N depends on which signal source is the
 * authoritative one.
 *
 * Per-phase threshold rationale (calibrated against squad workflow):
 *   • copy_engine   ·  3 days  — engine writes pages daily when on
 *   • cowork_step   ·  5 days  — 2-3 day cadence per strategist step
 *   • clickup_tasks ·  7 days  — dev/design tasks can sit a week
 *   • milestone     · 10 days  — coarser cadence, blocks for partner
 *   • phase_only    · 14 days  — nothing fine-grained → only big lag
 *   • intake        · 14 days  — slow ramp; flag if no movement
 *
 * Dismissal: per-project stalled_dismissed_until lets AMs silence a
 * known-slow step. When that timestamp is in the future, the
 * detector returns no signal for that project regardless of activity.
 */
import type { CurrentActivity } from './webCurrentActivity'
import { STALL_THRESHOLD_DAYS } from './webCurrentActivity'
import type { StrategyWebProject } from '../types/database'
import { daysBetween, fromIsoDate } from './dateRange'

export interface StallSignal {
  /** True when the current activity hasn't moved in over the
   *  threshold for its signal source. */
  isStalled: boolean
  /** Days since last activity. null when no signal has timestamps. */
  daysSinceActivity: number | null
  /** Threshold the detector applied (for "stalled X of Y days" UX). */
  thresholdDays: number
  /** Dismissed by user until this ISO. null when not dismissed. */
  dismissedUntil: string | null
  /** Short message: "Stalled 6 days on Outline page (threshold 5d)" */
  oneLiner: string | null
}

export interface StallInputs {
  project:  StrategyWebProject
  activity: CurrentActivity
  today?:   Date
}

export function detectStall(i: StallInputs): StallSignal {
  const today = i.today ?? new Date()
  const dismissedUntil = i.project.stalled_dismissed_until ?? null
  const isDismissed = (() => {
    if (!dismissedUntil) return false
    const d = new Date(dismissedUntil)
    return !isNaN(d.getTime()) && d.getTime() > today.getTime()
  })()

  const threshold = STALL_THRESHOLD_DAYS[i.activity.signal] ?? 14

  if (!i.activity.lastActivityAt) {
    return {
      isStalled: false,    // unknown ≠ stalled
      daysSinceActivity: null,
      thresholdDays: threshold,
      dismissedUntil,
      oneLiner: null,
    }
  }

  // lastActivityAt may be an ISO timestamptz or yyyy-mm-dd; parse safely.
  const lastAt = parseFlexible(i.activity.lastActivityAt)
  if (!lastAt) {
    return {
      isStalled: false,
      daysSinceActivity: null,
      thresholdDays: threshold,
      dismissedUntil,
      oneLiner: null,
    }
  }

  // Future timestamps (clock skew / mock data) shouldn't surface as
  // negative "stalled -3d" badges; clamp to 0.
  const days = Math.max(0, daysBetween(lastAt, today))
  const isStalled = !isDismissed && days >= threshold

  return {
    isStalled,
    daysSinceActivity: days,
    thresholdDays: threshold,
    dismissedUntil,
    oneLiner: isStalled
      ? `Stalled ${days} days on ${i.activity.stepName ?? i.activity.signal} (threshold ${threshold}d)`
      : null,
  }
}

function parseFlexible(iso: string): Date | null {
  // Try fromIsoDate (YYYY-MM-DD → local noon) first; fall back to Date()
  // for full timestamptz strings.
  const isoDate = fromIsoDate(iso)
  if (isoDate) return isoDate
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}
