/**
 * Signal consolidator for the Website Manager planning surface.
 *
 * The planning UI used to display `current_phase` ('intake' / 'content'
 * / 'design' / 'dev' / 'review' / 'launched') as the project's "where
 * it is" — which hid an enormous amount of fine-grained signal: the
 * 11-step cowork pipeline, the autonomous copy engine's per-page
 * counters, milestone-comms submissions, and ClickUp task progress.
 *
 * `buildCurrentActivity` fuses all four signals (plus the manual
 * status override) into a single `CurrentActivity` shape the UI can
 * render as one line. Priority ladder (most-specific wins):
 *
 *   1. Manual sub-status override (waiting / blocked / paused) — wins
 *      everything else, so AMs can pin a state regardless of activity.
 *   2. Project phase === 'launched' → done.
 *   3. Project phase === 'content':
 *      a. Copy engine actively running → 'copy_engine'.
 *      b. Cowork pipeline has any output → latest non-done step.
 *      c. Otherwise fall back to phase_only.
 *   4. Project phase ∈ {design, dev, review} AND ClickUp inference
 *      has tasks → 'clickup_tasks' with active/total counts.
 *   5. Milestone submissions exist → 'milestone' (latest one).
 *   6. Phase === 'intake' OR no signal → 'phase_only' / 'intake'.
 *
 * `lastActivityAt` is the canonical "when did this signal last move"
 * timestamp — every consumer (stall detection, digest, list view's
 * "since" timestamp) reads it from here so the source-of-truth ladder
 * is shared.
 */
import type {
  StrategyWebProject,
  WebProjectPhase,
  ManualSubStatus,
} from '../types/database'
import type { HealthMilestoneRow } from './webProjectHealth'
import type { PhaseInference } from './webPhaseInference'
import type { DevTaskRow } from '../hooks/useProjectsWithHealth'

// ── Public types ──────────────────────────────────────────────────

export type ActivitySignal =
  /** Project has launched; no further activity. */
  | 'launched'
  /** Phase = intake; nothing started yet. */
  | 'intake'
  /** Autonomous copy engine is actively writing pages. */
  | 'copy_engine'
  /** Strategist-driven 11-step cowork pipeline. */
  | 'cowork_step'
  /** ClickUp task progress (used outside the content phase). */
  | 'clickup_tasks'
  /** Latest milestone-comms submission. */
  | 'milestone'
  /** AM manually overrode the status (waiting/blocked/paused). */
  | 'manual_override'
  /** No fine-grained signal exists; we know the phase only. */
  | 'phase_only'

export interface CurrentActivity {
  /** Coarse phase the project is in (driven by current_phase + milestones). */
  phase: WebProjectPhase
  /** Which signal source informed the rest of this object. */
  signal: ActivitySignal
  /** Step number within the signal source (1-11 for cowork, null otherwise). */
  stepNumber:    number | null
  stepTotal:     number | null
  /** Strategist-language step name ("Outline page" / "Drafting pages"
   *  / "Engagement testing" / etc.). null when signal is phase_only. */
  stepName:      string | null
  /** Per-step progress when known (3 of 12 pages outlined → 3, 12). */
  progressDone:  number | null
  progressTotal: number | null
  /** ISO timestamp when the signal source last advanced. */
  lastActivityAt: string | null
  /** Manual override metadata when signal === 'manual_override'. */
  manualStatus:  ManualSubStatus | null
  manualReason:  string | null
  /** Renderer-friendly compact summary: "Outline page · 3/12 pages". */
  oneLiner: string
}

// ── Inputs ────────────────────────────────────────────────────────

export interface CurrentActivityInputs {
  project:     StrategyWebProject
  milestones:  HealthMilestoneRow[]
  devTasks:    DevTaskRow[]
  inference:   PhaseInference | null
}

// ── Cowork step labels ────────────────────────────────────────────
// Strategist-language for steps 1-11. Mirrors stepCatalog.ts titles
// but kept here so this lib stays UI-independent (the catalog
// imports React-y bits we don't want in a pure consolidator).

const COWORK_STEP_LABELS: Record<number, string> = {
  1:  'Pull out core messages',
  2:  'Capture site facts',
  3:  'Build strategic foundation',
  4:  'Identify ministry style',
  5:  'Map audience + funnel',
  6:  'Plan sitemap',
  7:  'Allocate content across pages',
  8:  'Outline pages',
  9:  'Draft pages',
  10: 'Critique pages',
  11: 'Roll up critique',
}
const COWORK_STEP_TOTAL = 11

// Output keys per step on roadmap_state (matches stepCatalog).
const STEP_OUTPUT_KEY: Record<number, string | null> = {
  1: null, 2: null,                                 // aggregate steps
  3:  'stage_1',
  4:  'ministry_model',
  5:  'acf_plan',
  6:  'site_strategy',
  7:  'page_allocation_plan',
  8:  'page_outlines',        // map of slug → entry
  9:  'page_drafts',
  10: 'page_critiques',
  11: 'critique_rollup',
}

// ── Milestone-definition step counts per Web pathway ──────────────
// Source: strategy_milestone_definitions (queried 2026-06-20). Static
// because the taxonomy is stable; if a new pathway is added, surface
// it here. pathwayTotalFor accepts the project's `kind` as a
// fallback when the milestone's pathway field is null.

const WEB_PATHWAY_TOTAL: Record<string, number> = {
  redesign: 9,
  audit:    4,
  onboarding: 1,
  internal: 1,
  'Web Support': 1,
}

const WEB_REDESIGN_STEPS: Record<number, string> = {
  1: 'Onboard & Content Collection',
  2: 'Review: Website Strategy',
  3: 'Copywriting Phase',
  4: 'Review: Copywriting',
  5: 'Design Phase',
  6: 'Review: Design System',
  7: 'Build Phase',
  8: 'Review: Final Website',
  9: 'Site Launch',
}
const WEB_AUDIT_STEPS: Record<number, string> = {
  1: 'Onboard & Audit Prep',
  2: 'Strategic Audit',
  3: 'Review: Audit Findings',
  4: 'Audit Handoff',
}
export const WEB_MILESTONE_STEP_NAMES: Record<string, Record<number, string>> = {
  redesign: WEB_REDESIGN_STEPS,
  audit:    WEB_AUDIT_STEPS,
}
export { WEB_PATHWAY_TOTAL, COWORK_STEP_LABELS, COWORK_STEP_TOTAL }

function pathwayTotalFor(kind: string | null | undefined, pathway: string | null): number | null {
  if (pathway && WEB_PATHWAY_TOTAL[pathway] != null) return WEB_PATHWAY_TOTAL[pathway]
  if (kind && WEB_PATHWAY_TOTAL[kind] != null) return WEB_PATHWAY_TOTAL[kind]
  return null
}

// ── Copy engine phase labels ──────────────────────────────────────

const COPY_ENGINE_PHASE_LABELS: Record<string, string> = {
  page_outlines:        'Outlining pages',
  page_drafts:          'Drafting pages',
  director_critique:    'Critiquing drafts',
  applying_directives:  'Applying revisions',
  awaiting_critique:    'Awaiting critique',
  awaiting_final_review:'Awaiting final review',
}

const COPY_ENGINE_TERMINAL_STATUSES = new Set([
  'awaiting_final_review',
  'cancelled_during_drafts',
  'cancelled',
  'complete',
  'done',
  'error',
])

// ── Helpers ───────────────────────────────────────────────────────

function getMeta(node: unknown): { generated_at?: string } | null {
  if (!node || typeof node !== 'object') return null
  const meta = (node as { _meta?: unknown })._meta
  if (!meta || typeof meta !== 'object') return null
  return meta as { generated_at?: string }
}

function entriesCount(node: unknown): { done: number; latestAt: string | null } {
  /** For step-8/9/10: roadmap_state.<key> is a map of slug → entry.
   *  Count entries that have a _meta.generated_at; track the latest. */
  if (!node || typeof node !== 'object') return { done: 0, latestAt: null }
  let done = 0
  let latestAt: string | null = null
  for (const v of Object.values(node as Record<string, unknown>)) {
    const m = getMeta(v)
    const at = m?.generated_at
    if (at) {
      done++
      if (!latestAt || at > latestAt) latestAt = at
    }
  }
  return { done, latestAt }
}

function sitemapTotal(roadmapState: Record<string, unknown> | undefined): number {
  /** Total pages = length of site_strategy.pages (the canonical sitemap). */
  if (!roadmapState) return 0
  const s = roadmapState.site_strategy as { pages?: unknown[] } | undefined
  if (Array.isArray(s?.pages)) return s.pages.length
  return 0
}

// ── Main entry ────────────────────────────────────────────────────

export function buildCurrentActivity(i: CurrentActivityInputs): CurrentActivity {
  const { project, milestones, devTasks, inference } = i
  const phase = (project.current_phase ?? 'intake') as WebProjectPhase
  const roadmap = (project.roadmap_state ?? {}) as Record<string, unknown>

  // ── 1. Manual override always wins ─────────────────────────
  if (project.manual_sub_status) {
    return {
      phase,
      signal: 'manual_override',
      stepNumber: null, stepTotal: null, stepName: null,
      progressDone: null, progressTotal: null,
      lastActivityAt: project.status_changed_at ?? null,
      manualStatus: project.manual_sub_status,
      manualReason: project.status_reason ?? null,
      oneLiner: oneLinerForManual(project.manual_sub_status, project.status_reason),
    }
  }

  // ── 2. Launched short-circuit ──────────────────────────────
  if (phase === 'launched') {
    return zero('launched', phase, 'Launched')
  }

  // ── 3. Content phase: copy engine > cowork > phase ─────────
  if (phase === 'content') {
    // 3a. Copy engine running?
    const engine = roadmap.engine_state as Record<string, unknown> | undefined
    if (engine && typeof engine === 'object') {
      const status = String(engine.status ?? '')
      const enginePhase = String(engine.current_phase ?? '')
      if (status && !COPY_ENGINE_TERMINAL_STATUSES.has(status) && enginePhase) {
        const label = COPY_ENGINE_PHASE_LABELS[enginePhase] ?? enginePhase
        const done  = Number(engine.pages_drafted ?? 0)
        const total = Number(engine.pages_total ?? sitemapTotal(roadmap))
        const lastAt = String(engine.last_action_at ?? '') || null
        return {
          phase, signal: 'copy_engine',
          stepNumber: null, stepTotal: null,
          stepName: label,
          progressDone: Number.isFinite(done) ? done : null,
          progressTotal: total > 0 ? total : null,
          lastActivityAt: lastAt,
          manualStatus: null, manualReason: null,
          oneLiner: total > 0
            ? `${label} · ${done}/${total} pages`
            : label,
        }
      }
    }

    // 3b. Cowork pipeline — find the latest step that has activity.
    const coworkInfo = inspectCoworkPipeline(roadmap)
    if (coworkInfo) {
      return {
        phase, signal: 'cowork_step',
        stepNumber:  coworkInfo.stepNumber,
        stepTotal:   COWORK_STEP_TOTAL,
        stepName:    coworkInfo.stepName,
        progressDone:  coworkInfo.progressDone,
        progressTotal: coworkInfo.progressTotal,
        lastActivityAt: coworkInfo.lastActivityAt,
        manualStatus: null, manualReason: null,
        oneLiner: coworkInfo.progressTotal != null && coworkInfo.progressDone != null
          ? `Step ${coworkInfo.stepNumber}/${COWORK_STEP_TOTAL}: ${coworkInfo.stepName} · ${coworkInfo.progressDone}/${coworkInfo.progressTotal}`
          : `Step ${coworkInfo.stepNumber}/${COWORK_STEP_TOTAL}: ${coworkInfo.stepName}`,
      }
    }

    // 3c. Fall back to phase only.
    return phaseOnly(phase, 'Content phase — no pipeline activity yet')
  }

  // ── 4. Design / dev / review: ClickUp inference ────────────
  if (phase === 'design' || phase === 'dev' || phase === 'review') {
    if (inference && inference.totalTasks > 0) {
      const phaseTaskTotal = inference.totalTasks
      const phaseProgress  = inference.perPhase?.[phase] ?? null
      const done = phaseProgress != null
        ? Math.round(phaseProgress * phaseTaskTotal)
        : null
      const latestTask = devTasks
        .filter(t => t.due_date_after)
        .map(t => t.due_date_after)
        .sort()
        .pop() ?? null
      return {
        phase, signal: 'clickup_tasks',
        stepNumber: null, stepTotal: null,
        stepName: phaseLabel(phase),
        progressDone:  done,
        progressTotal: phaseTaskTotal,
        lastActivityAt: latestTask,
        manualStatus: null, manualReason: null,
        oneLiner: done != null && phaseTaskTotal > 0
          ? `${phaseLabel(phase)} · ${done}/${phaseTaskTotal} tasks`
          : `${phaseLabel(phase)} · ${phaseTaskTotal} tasks`,
      }
    }
  }

  // ── 5. Milestone fallback ─────────────────────────────────
  // Milestones come from strategy_milestone_definitions — the
  // PARTNER-FACING step list. Web redesign has 9 steps (Onboard →
  // Review: Strategy → Copywriting → Review: Copywriting → Design
  // → Review: Design System → Build → Review: Final → Launch);
  // Web audit has 4. The latest submitted milestone IS the current
  // signal when no finer-grained source is active.
  if (milestones.length > 0) {
    const latest = milestones[0]   // Already sorted desc by submitted_at
    const stepNum  = latest.step_number ?? null
    const pathwayTotal = pathwayTotalFor(project.kind, latest.pathway ?? null)
    const stepName = WEB_MILESTONE_STEP_NAMES[latest.pathway ?? ''] ?? null
    const stepLabel = stepNum != null && stepName?.[stepNum]
      ? stepName[stepNum]
      : (latest.milestone_status ?? 'submitted')
    const oneLiner = stepNum != null && pathwayTotal
      ? `Step ${stepNum}/${pathwayTotal}: ${stepLabel}`
      : stepLabel
    return {
      phase, signal: 'milestone',
      stepNumber: stepNum, stepTotal: pathwayTotal,
      stepName: stepLabel,
      progressDone: null, progressTotal: null,
      lastActivityAt: latest.submitted_at,
      manualStatus: null, manualReason: null,
      oneLiner,
    }
  }

  // ── 6. Final fallback: phase only ─────────────────────────
  if (phase === 'intake') return zero('intake', phase, 'Intake')
  return phaseOnly(phase, phaseLabel(phase))
}

// ── Cowork pipeline inspector ─────────────────────────────────────

interface CoworkInfo {
  stepNumber:     number
  stepName:       string
  progressDone:   number | null
  progressTotal:  number | null
  lastActivityAt: string | null
}

function inspectCoworkPipeline(roadmap: Record<string, unknown>): CoworkInfo | null {
  // Walk steps 11 → 3 (skip 1-2 which are aggregate). Return the
  // HIGHEST step that has activity (so a project mid-step-9 reports
  // step 9, not step 3).
  const total = sitemapTotal(roadmap)

  for (let step = 11; step >= 3; step--) {
    const key = STEP_OUTPUT_KEY[step]
    if (!key) continue
    const node = roadmap[key]
    if (!node) continue

    // Per-page steps (8/9/10): count entries in the map.
    if (step === 8 || step === 9 || step === 10) {
      const { done, latestAt } = entriesCount(node)
      if (done === 0) continue
      return {
        stepNumber: step,
        stepName: COWORK_STEP_LABELS[step],
        progressDone: done,
        progressTotal: total > 0 ? total : done,
        lastActivityAt: latestAt,
      }
    }

    // Project-level steps (3/4/5/6/7/11): single artifact w/ _meta.
    const meta = getMeta(node)
    if (!meta?.generated_at) continue
    return {
      stepNumber: step,
      stepName: COWORK_STEP_LABELS[step],
      progressDone: null,
      progressTotal: null,
      lastActivityAt: meta.generated_at,
    }
  }
  return null
}

// ── Small helpers ─────────────────────────────────────────────────

function phaseLabel(phase: WebProjectPhase): string {
  switch (phase) {
    case 'intake':   return 'Intake'
    case 'content':  return 'Content'
    case 'design':   return 'Design'
    case 'dev':      return 'Dev'
    case 'review':   return 'Final review'
    case 'launched': return 'Launched'
    default:         return phase
  }
}

function zero(signal: ActivitySignal, phase: WebProjectPhase, oneLiner: string): CurrentActivity {
  return {
    phase, signal,
    stepNumber: null, stepTotal: null, stepName: null,
    progressDone: null, progressTotal: null,
    lastActivityAt: null,
    manualStatus: null, manualReason: null,
    oneLiner,
  }
}

function phaseOnly(phase: WebProjectPhase, oneLiner: string): CurrentActivity {
  return {
    phase, signal: 'phase_only',
    stepNumber: null, stepTotal: null, stepName: null,
    progressDone: null, progressTotal: null,
    lastActivityAt: null,
    manualStatus: null, manualReason: null,
    oneLiner,
  }
}

function oneLinerForManual(status: ManualSubStatus, reason: string | null): string {
  const label =
    status === 'waiting_partner' ? 'Waiting on partner'
  : status === 'blocked'         ? 'Blocked'
  : status === 'paused'          ? 'Paused'
                                 : 'In progress'
  return reason ? `${label} — ${reason}` : label
}

// ── Stall threshold per signal/phase ──────────────────────────────
// Used by the stall detector lib. Centralized here so the stall
// thresholds live next to the signal that drives them.
export const STALL_THRESHOLD_DAYS: Record<ActivitySignal, number> = {
  manual_override: 99,   // never auto-flag a manually-set status
  launched:        99,
  intake:          14,
  copy_engine:      3,   // engine should advance daily when running
  cowork_step:      5,   // strategist steps run on 2-3 day cycles
  clickup_tasks:    7,   // dev/design tasks can sit a week
  milestone:       10,   // milestones are mid-coarseness
  phase_only:      14,   // phase known but nothing happening → slower flag
}
