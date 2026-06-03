/**
 * Dev queue — sequential capacity projection across every active
 * project, ordered by priority.
 *
 * The dev is a serial resource; each project consumes hours in
 * priority order, drawing from a SHARED weekly capacity pool. When
 * P1 only needs 4h of a 32.75h-week, P2 picks up the leftover 28.75h
 * the same week instead of waiting for the next one — that's the
 * "Sprint 4 could start earlier" behavior the team kept asking for.
 *
 * Output per project: which weeks the dev is on it, how many hours
 * each week, and a flat devStart/devEnd window for callers that
 * just want the band.
 *
 * Pure — no I/O. Consumed by `useProjectsWithHealth` (board) and
 * `PlanningWorkspace` (single project view). Both call
 * `computeProjectHealth` with the slot, which uses devEndDate as the
 * launch projection instead of the per-project capacity fallback.
 */
import { fromIsoDate, toIsoDate, weekStart, addWeeks } from './dateRange'
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
  /** Per-week hours this project consumes from the dev's shared
   *  capacity pool. Keys are ISO week-start dates (Sun-based). The
   *  schedule view renders these directly instead of re-deriving. */
  weeklyHours:         Record<string, number>
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

  const out = new Map<string, QueueSlot>()
  const cap = Math.max(capacityPerWeek, 0)
  if (cap <= 0) return out

  // Shared weekly pool — hours already claimed across all higher-
  // priority projects, keyed by week-start ISO. Drains as each
  // project consumes capacity in order.
  const weeklyClaims   = new Map<string, number>()
  let cursorWeek       = weekStart(today)
  let cumulativeHours  = 0

  for (const p of ordered) {
    const { hours, usedManual } = remainingDevHoursFor(p)
    const weeklyHours: Record<string, number> = {}
    let needed = hours
    let firstWeekIso: string | null = null
    let lastWeekIso:  string | null = null
    // Step forward week-by-week, draining the free capacity in the
    // current week before rolling to the next. The cursor never
    // moves backward — once a week is full, it stays full.
    let w = cursorWeek
    if (needed > 0) {
      // Hard guard: never loop forever. Two years is far past any
      // real planning horizon and protects us from divide-by-zero
      // bugs upstream.
      for (let i = 0; i < 104; i++) {
        const wIso    = toIsoDate(w)
        const claimed = weeklyClaims.get(wIso) ?? 0
        const free    = Math.max(0, cap - claimed)
        if (free <= 0) {
          w = addWeeks(w, 1)
          continue
        }
        const take = Math.min(needed, free)
        weeklyClaims.set(wIso, claimed + take)
        weeklyHours[wIso] = (weeklyHours[wIso] ?? 0) + take
        if (firstWeekIso == null) firstWeekIso = wIso
        lastWeekIso = wIso
        needed -= take
        // Update the cursor — next project starts from this same
        // week if there's any leftover, otherwise the next week.
        if (free - take <= 0) {
          w = addWeeks(w, 1)
        }
        if (needed <= 0) break
      }
    }

    // Roll the shared cursor forward to the earliest week that still
    // has free capacity. Projects that need ZERO hours don't move it.
    if (firstWeekIso != null && lastWeekIso != null) {
      cursorWeek = (weeklyClaims.get(lastWeekIso) ?? 0) >= cap
        ? addWeeks(fromIsoDate(lastWeekIso) as Date, 1)
        : fromIsoDate(lastWeekIso) as Date
    }

    out.set(p.id, {
      projectId:           p.id,
      priority:            p.priority_order ?? null,
      remainingDevHours:   round1(hours),
      hoursBeforeStart:    round1(cumulativeHours),
      devStartDate:        firstWeekIso ?? toIsoDate(cursorWeek),
      devEndDate:          lastWeekIso  ?? toIsoDate(cursorWeek),
      designDeadline:      firstWeekIso ?? toIsoDate(cursorWeek),
      usedManualRemaining: usedManual,
      weeklyHours,
    })
    cumulativeHours += hours
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

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
