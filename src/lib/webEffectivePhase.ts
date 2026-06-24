/**
 * webEffectivePhase — derives the project's effective phase from
 * `current_phase` + `step_timeline_overrides`.
 *
 * The Planning step timeline lets staff manually mark rows as done
 * (with cascade-backwards on Done). When the user marks the final
 * milestone or the launched phase as done, downstream views should
 * treat the project as launched — even if the project row's
 * `current_phase` column hasn't been updated to 'launched' yet.
 *
 * This helper keeps that derivation in one place so every consumer
 * (queue grouping, activity label, status pill) reads consistently.
 */
import type { StrategyWebProject, WebProjectPhase } from '../types/database'

type Overrides = Record<string, 'done' | 'active' | 'upcoming' | 'skipped'>

/** The redesign Site Launch milestone (step 9) and the audit Site
 *  Launch milestone (step 4). Marking either as done — or marking the
 *  `launched` phase row directly — is treated as launch-complete. */
const LAUNCH_MILESTONES_BY_KIND: Record<string, number> = {
  redesign:  9,
  audit:     4,
  microsite: 9,
}

/** Read the project's effective phase. Falls through to the stored
 *  `current_phase` when no override forces a launched state. */
export function effectiveCurrentPhase(
  project: Pick<StrategyWebProject, 'current_phase' | 'kind' | 'step_timeline_overrides'>,
): WebProjectPhase {
  const overrides = (project.step_timeline_overrides ?? {}) as Overrides
  const launchMilestone =
    LAUNCH_MILESTONES_BY_KIND[(project.kind as string) ?? 'redesign'] ?? 9

  if (overrides['phase:launched'] === 'done') return 'launched'
  if (overrides[`milestone:${launchMilestone}`] === 'done') return 'launched'

  return (project.current_phase ?? 'intake') as WebProjectPhase
}
