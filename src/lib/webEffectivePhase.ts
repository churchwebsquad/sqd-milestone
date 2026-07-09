/**
 * webEffectivePhase — derives the project's effective phase from
 * `current_phase` + `step_timeline_overrides` + roadmap_state activity.
 *
 * Two sources of drift the stored `current_phase` column doesn't
 * capture on its own:
 *
 * 1. Manual launch override — the Planning step timeline lets staff
 *    mark rows done (cascade-backwards on Done); marking the launch
 *    milestone or the `launched` phase itself must promote the project
 *    even when nothing wrote `current_phase = 'launched'` back to the
 *    DB.
 *
 * 2. Content Engine drift — the stored current_phase is set to
 *    'intake' at project creation and never auto-advanced. A project
 *    can be six sub-steps into the Content Engine (sitemap done,
 *    partner-review published, downstream drafts underway) while the
 *    column still says 'intake'. Every queue label / phase pill would
 *    read "intake · ready for strategy" instead of "content · sitemap
 *    awaiting partner". This helper promotes to 'content' the moment
 *    any Content Engine artifact lands.
 *
 * Every consumer (queue grouping, activity label, status pill) reads
 * through this helper so the derivation stays consistent.
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

/** Shape sniffed on `roadmap_state` to decide whether the Content
 *  Engine has started. Every field is optional — we only need one to
 *  be present to promote the phase. */
interface ContentEnginePresence {
  stage_1?:              { _meta?: { generated_at?: string } }
  ministry_model?:       { _meta?: { generated_at?: string } }
  acf_plan?:             { _meta?: { generated_at?: string } }
  site_strategy?:        { _meta?: { generated_at?: string } }
  page_allocation_plan?: { _meta?: { generated_at?: string } }
  page_seo_plans?:       { _meta?: { generated_at?: string } }
  page_outlines?:        Record<string, unknown>
  page_drafts?:          Record<string, unknown>
  page_critiques?:       Record<string, unknown>
  critique_rollup?:      { _meta?: { generated_at?: string } }
  /** Sitemap review exists — draft/published/partner_reviewed/approved
   *  all count. Creation of the review row itself signals Content
   *  Engine step 6 fired. */
  sitemap_review?:       { status?: string; token?: string }
}

function contentEngineStarted(roadmapState: unknown): boolean {
  if (!roadmapState || typeof roadmapState !== 'object') return false
  const r = roadmapState as ContentEnginePresence
  if (r.stage_1?._meta?.generated_at)              return true
  if (r.ministry_model?._meta?.generated_at)       return true
  if (r.acf_plan?._meta?.generated_at)             return true
  if (r.site_strategy?._meta?.generated_at)        return true
  if (r.page_allocation_plan?._meta?.generated_at) return true
  if (r.page_seo_plans?._meta?.generated_at)       return true
  if (r.critique_rollup?._meta?.generated_at)      return true
  if (hasAnyEntry(r.page_outlines))                return true
  if (hasAnyEntry(r.page_drafts))                  return true
  if (hasAnyEntry(r.page_critiques))               return true
  // Sitemap review row created = step 6 ran (or was drafted manually);
  // either way the project is past intake.
  if (r.sitemap_review && (r.sitemap_review.status || r.sitemap_review.token)) return true
  return false
}

function hasAnyEntry(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (v && typeof v === 'object' && (v as { _meta?: unknown })._meta) return true
  }
  return false
}

/** Read the project's effective phase. Order of promotion:
 *
 *   1. Manual launched override (step-timeline / phase:launched) → 'launched'
 *   2. Stored current_phase past 'intake' → trust it (staff or a
 *      downstream job has already advanced the column).
 *   3. current_phase is 'intake' but Content Engine has started → 'content'
 *   4. Fall through to stored current_phase (default 'intake').
 */
export function effectiveCurrentPhase(
  project: Pick<StrategyWebProject, 'current_phase' | 'kind' | 'step_timeline_overrides' | 'roadmap_state'>,
): WebProjectPhase {
  const overrides = (project.step_timeline_overrides ?? {}) as Overrides
  const launchMilestone =
    LAUNCH_MILESTONES_BY_KIND[(project.kind as string) ?? 'redesign'] ?? 9

  if (overrides['phase:launched'] === 'done') return 'launched'
  if (overrides[`milestone:${launchMilestone}`] === 'done') return 'launched'

  const stored = (project.current_phase ?? 'intake') as WebProjectPhase

  // If the stored column has already been advanced past intake, trust
  // it — downstream systems (design, dev, review, launched) each own
  // their own transitions, and we don't want to demote a project just
  // because a roadmap_state key isn't set.
  if (stored !== 'intake') return stored

  // Column says intake but the Content Engine has clearly started.
  // Promote so queue labels / phase pills reflect reality.
  if (contentEngineStarted(project.roadmap_state)) return 'content'

  return stored
}
