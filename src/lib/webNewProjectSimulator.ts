/**
 * New-project launch simulator — answers the question:
 *
 *   "When could a new church launch, given the current queue?"
 *
 * Inputs (sandboxed — nothing is written):
 *   - expectedPageCount  (e.g. WoodCreek = 20)
 *   - devHoursPerPage    (team default 3.0)
 *   - usesNovamira       (cuts hours by 50%)
 *   - devEditsToDesigner (cuts review-cycle dev by ~15%)
 *   - assistHoursPerWeek (extra capacity Ashley contributes)
 *   - desiredPriority    (where the new project would slot in)
 *   - capacityPerWeek    (team default 35)
 *   - existingProjects   (the real strategy_web_projects rows)
 *
 * Output:
 *   - hoursNeeded        — the new project's dev-hour budget
 *   - earliestDevStart   — first week the queue can pick it up
 *   - earliestLaunch     — projected dev completion
 *   - cascadeImpact[]    — per-existing-project deltaDays vs.
 *                          their current devEnd, when the new
 *                          project slots in at desiredPriority.
 *
 * Pure — no DB I/O. The caller passes in current rows.
 */
import { computeDevQueue, type QueueSlot } from './webDevQueue'
import { computeDevHoursTotal } from './webPlanningMath'
import type { StrategyWebProject } from '../types/database'
import { fromIsoDate } from './dateRange'

export interface SimulatorInput {
  expectedPageCount:    number
  devHoursPerPage:      number
  usesNovamira:         boolean
  devEditsToDesigner:   boolean
  assistHoursPerWeek:   number
  desiredPriority:      number    // 1-based; existing projects at or below shift down
  capacityPerWeek:      number    // team default 35
  existingProjects:     StrategyWebProject[]
  pageCountsByProject?: Map<string, number | null>  // actual web_pages count
  today:                Date
}

export interface CascadeRow {
  projectId:       string
  projectName:     string
  beforeDevEnd:    string         // ISO
  afterDevEnd:     string         // ISO
  deltaDays:       number         // positive = delayed; negative = earlier
}

export interface SimulatorOutput {
  hoursNeeded:        number
  hoursNote:          string       // 1-liner explaining the math
  earliestDevStart:   string       // ISO
  earliestLaunch:     string       // ISO
  cascadeImpact:      CascadeRow[]
  weeklyHours:        Record<string, number>  // hours/week the new project would consume
}

/** Run the simulator. Idempotent; safe to call on every keystroke. */
export function simulateNewProjectLaunch(input: SimulatorInput): SimulatorOutput {
  // 1. Capture the BEFORE-state queue (without the hypothetical project).
  const beforeSlots = computeDevQueue(
    input.existingProjects.map(p => ({
      ...p,
      actual_page_count: input.pageCountsByProject?.get(p.id) ?? null,
    })),
    input.capacityPerWeek,
    input.today,
  )

  // 2. Compute the hypothetical project's dev-hour need.
  const hoursTotal = computeDevHoursTotal({
    manualOverride:           null,
    expectedPageCount:        input.expectedPageCount,
    actualPageCount:          null,
    hoursPerPage:             input.devHoursPerPage,
    usesNovamira:             input.usesNovamira,
    devEditsRouteToDesigner:  input.devEditsToDesigner,
  })

  // 3. Build a synthetic project row + push existing peers down a slot
  //    when their priority is at or above `desiredPriority`.
  const synthId = `__sim_new_project__`
  const shifted: StrategyWebProject[] = input.existingProjects.map(p => {
    const cur = p.priority_order ?? Number.POSITIVE_INFINITY
    if (cur >= input.desiredPriority) {
      return { ...p, priority_order: cur === Number.POSITIVE_INFINITY ? null : cur + 1 }
    }
    return p
  })
  const synth: StrategyWebProject = {
    // Minimal scaffold — only the fields computeDevQueue reads.
    ...(input.existingProjects[0] ?? ({} as StrategyWebProject)),
    id:                          synthId,
    priority_order:              input.desiredPriority,
    archived:                    false,
    current_phase:               'intake',
    manual_remaining_hours:      null,
    phase_estimates:             {},
    phase_progress:              {},
    dev_hours_estimate:          null,
    expected_page_count:         input.expectedPageCount,
    dev_hours_per_page:          input.devHoursPerPage,
    uses_novamira:               input.usesNovamira,
    dev_edits_route_to_designer: input.devEditsToDesigner,
    assist_hours_per_week_extra: input.assistHoursPerWeek,
    pre_dev_complete:            false,
  }

  // 4. Re-run the queue with the synthetic row inserted.
  const afterSlots = computeDevQueue(
    [...shifted.map(p => ({
      ...p,
      actual_page_count: input.pageCountsByProject?.get(p.id) ?? null,
    })), { ...synth, actual_page_count: null }],
    input.capacityPerWeek,
    input.today,
  )

  // 5. Cascade — for each existing project, compare devEnd before vs after.
  const cascade: CascadeRow[] = []
  for (const p of input.existingProjects) {
    const before = beforeSlots.get(p.id)
    const after  = afterSlots.get(p.id)
    if (!before || !after) continue
    if (before.devEndDate === after.devEndDate) continue
    cascade.push({
      projectId:    p.id,
      projectName:  p.church_name ?? p.name ?? p.id.slice(0, 8),
      beforeDevEnd: before.devEndDate,
      afterDevEnd:  after.devEndDate,
      deltaDays:    daysBetween(before.devEndDate, after.devEndDate),
    })
  }
  cascade.sort((a, b) => Math.abs(b.deltaDays) - Math.abs(a.deltaDays))

  const synthSlot: QueueSlot | undefined = afterSlots.get(synthId)
  return {
    hoursNeeded:      hoursTotal.total,
    hoursNote:        hoursTotal.note,
    earliestDevStart: synthSlot?.devStartDate ?? '',
    earliestLaunch:   synthSlot?.devEndDate   ?? '',
    cascadeImpact:    cascade,
    weeklyHours:      synthSlot?.weeklyHours  ?? {},
  }
}

function daysBetween(aIso: string, bIso: string): number {
  const a = fromIsoDate(aIso)
  const b = fromIsoDate(bIso)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}
