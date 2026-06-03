/**
 * Dev queue — sequential capacity projection across every active
 * project, ordered by priority.
 *
 * The dev is a serial resource (one project at a time on the build
 * side). Each project consumes hours in priority order; the dev
 * finishes P1, then immediately picks up P2, and so on. This pure
 * helper walks the queue once and stamps each project with:
 *
 *   • devStartDate   — when the dev picks this project up
 *   • devEndDate     — projected dev completion
 *   • designDeadline — same as devStartDate. Backwards chaining: the
 *                      designer needs to be done with THIS project's
 *                      design by then so dev can start on schedule.
 *
 * Pure — no I/O. Consumed by `useProjectsWithHealth` (board) and
 * `PlanningWorkspace` (single project view). Both call
 * `computeProjectHealth` with the slot, which uses devEndDate as the
 * launch projection instead of the per-project capacity fallback.
 */
import { fromIsoDate, toIsoDate } from './dateRange'
import {
  phaseRank,
  type WebProjectPhase,
} from './webProjectHealth'
import type {
  StrategyWebProject,
  PhaseEstimates,
  PhaseProgress,
} from '../types/database'

export interface QueueSlot {
  projectId:           string
  priority:            number | null
  /** Hours of dev work this project still owes the queue. */
  remainingDevHours:   number
  /** Hours of dev work that sit in front of this project. */
  hoursBeforeStart:    number
  /** ISO yyyy-mm-dd — first day the dev picks this project up. */
  devStartDate:        string
  /** ISO yyyy-mm-dd — projected dev completion. Becomes the project's
   *  launch projection in `computeProjectHealth`. */
  devEndDate:          string
  /** ISO yyyy-mm-dd — design must finish by this date so dev can
   *  start on schedule. Same as devStartDate in v1 — add buffer days
   *  later if the team wants a slack window. */
  designDeadline:      string
  /** True when manual_remaining_hours drove the queue contribution. */
  usedManualRemaining: boolean
}

type QueueProject = Pick<
  StrategyWebProject,
  'id' | 'priority_order' | 'archived' | 'current_phase' |
  'manual_remaining_hours' | 'phase_estimates' | 'phase_progress' |
  'dev_hours_estimate'
>

/** Total queue-consuming hours per project. Only the DEV phase
 *  contributes — earlier phases (intake/content/design) happen
 *  in parallel by other team members and don't compete for Josh.
 *  Once dev is finished (current_phase = 'review' or 'launched')
 *  the project no longer consumes queue capacity. */
function remainingDevHoursFor(p: QueueProject): { hours: number; usedManual: boolean } {
  // Manual override always wins, regardless of phase. The team uses
  // it when they know the real number better than the math does.
  if (typeof p.manual_remaining_hours === 'number'
      && p.manual_remaining_hours >= 0) {
    return { hours: Number(p.manual_remaining_hours), usedManual: true }
  }
  const phase = (p.current_phase ?? 'intake') as WebProjectPhase
  // Past dev — review-phase touch-ups are tiny; not modeled in v1.
  if (phaseRank(phase) > phaseRank('dev')) return { hours: 0, usedManual: false }

  const est:  PhaseEstimates = p.phase_estimates ?? {}
  const prog: PhaseProgress  = p.phase_progress  ?? {}
  const devEst  = Number(est.dev ?? 0)
  const devProg = Math.min(1, Math.max(0, Number(prog.dev ?? 0)))
  if (devEst > 0) return { hours: devEst * (1 - devProg), usedManual: false }

  // No phase estimate — fall back to dev_hours_estimate. The CSV
  // importer stamps this as the TOTAL dev cost for the project, so
  // it's the right anchor when no per-phase split exists.
  if (p.dev_hours_estimate) {
    return {
      hours: Number(p.dev_hours_estimate) * (1 - devProg),
      usedManual: false,
    }
  }
  return { hours: 0, usedManual: false }
}

export function computeDevQueue(
  projects:         QueueProject[],
  capacityPerWeek:  number,
  today:            Date,
): Map<string, QueueSlot> {
  const active = projects.filter(p =>
    !p.archived && (p.current_phase ?? 'intake') !== 'launched',
  )
  // Priority order ASC, nulls last (de-prioritized projects sit at
  // the tail of the queue).
  const ordered = [...active].sort((a, b) => {
    const pa = a.priority_order ?? Number.POSITIVE_INFINITY
    const pb = b.priority_order ?? Number.POSITIVE_INFINITY
    if (pa !== pb) return pa - pb
    return a.id.localeCompare(b.id)
  })

  const out      = new Map<string, QueueSlot>()
  const capDay   = Math.max(capacityPerWeek, 0) / 7
  if (capDay <= 0) return out  // no capacity, no schedule

  let cursor = 0
  for (const p of ordered) {
    const { hours, usedManual } = remainingDevHoursFor(p)
    const startOffsetDays = Math.floor(cursor / capDay)
    // End needs at least 1 day past start when there's any work,
    // even if rounding would collapse it to zero.
    const endOffsetDays   = hours > 0
      ? Math.max(startOffsetDays + 1, Math.ceil((cursor + hours) / capDay))
      : startOffsetDays
    const startDate = addDays(today, startOffsetDays)
    const endDate   = addDays(today, endOffsetDays)
    out.set(p.id, {
      projectId:           p.id,
      priority:            p.priority_order ?? null,
      remainingDevHours:   round1(hours),
      hoursBeforeStart:    round1(cursor),
      devStartDate:        toIsoDate(startDate),
      devEndDate:          toIsoDate(endDate),
      designDeadline:      toIsoDate(startDate),
      usedManualRemaining: usedManual,
    })
    cursor += hours
  }
  return out
}

/** Find the project whose dev work the dev is currently inside.
 *  Returns null when there's no active work (queue empty). */
export function activeQueueProjectId(slots: Map<string, QueueSlot>, today: Date): string | null {
  for (const s of slots.values()) {
    const start = fromIsoDate(s.devStartDate)
    const end   = fromIsoDate(s.devEndDate)
    if (!start || !end) continue
    if (start <= today && today < end) return s.projectId
  }
  return null
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
