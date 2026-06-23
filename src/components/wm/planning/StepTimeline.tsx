/**
 * Vertical step timeline for the per-project Planning tab.
 *
 * Three nesting levels reflect the actual operational reality:
 *   1. Phase  (intake / content / design / dev / review / launched)
 *   2. Milestone step  (Web redesign has 9 partner-facing milestones)
 *   3. Cowork sub-step (11 inside the Copywriting Phase milestone)
 *
 * The current phase auto-expands; others collapse. Each row shows
 * status + progress when applicable + the timestamp of last
 * activity, with a "Why?" provenance hover on every state.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Check, Circle, CircleDashed } from 'lucide-react'
import {
  WEB_MILESTONE_STEP_NAMES,
  COWORK_STEP_LABELS,
  COWORK_STEP_TOTAL,
  type CurrentActivity,
} from '../../../lib/webCurrentActivity'
import type { StrategyWebProject, WebProjectPhase, PhaseProgress, HealthMilestoneRow } from '../../../types/database'

interface Props {
  project:    StrategyWebProject
  milestones: HealthMilestoneRow[]
  /** Output of buildCurrentActivity — used to highlight the current row. */
  activity:   CurrentActivity
  /** Manual phase_progress for "Mark phase complete" affordance. */
  effectiveProgress: PhaseProgress
}

const PHASE_ORDER: WebProjectPhase[] = [
  'intake', 'content', 'design', 'dev', 'review', 'launched',
]
const PHASE_LABEL: Record<WebProjectPhase, string> = {
  intake: 'Intake', content: 'Content', design: 'Design',
  dev: 'Dev', review: 'Final review', launched: 'Launched',
}

// Phase → which partner-facing milestone steps belong to it. Built
// from the milestone-definition taxonomy for the redesign pathway.
// Audit projects use a different mapping (handled via project.kind).
const PHASE_MILESTONES_REDESIGN: Record<WebProjectPhase, number[]> = {
  intake:   [1],
  content:  [2, 3, 4],     // Strategy → Copywriting → Review: Copywriting
  design:   [5, 6],        // Design → Review: Design System
  dev:      [7],
  review:   [8],
  launched: [9],
}
const PHASE_MILESTONES_AUDIT: Record<WebProjectPhase, number[]> = {
  intake:   [1],
  content:  [2],
  design:   [],
  dev:      [],
  review:   [3],
  launched: [4],
}

type RowKind = 'phase' | 'milestone' | 'cowork'
interface TimelineRow {
  kind:       RowKind
  key:        string
  label:      string
  status:     'done' | 'active' | 'upcoming' | 'skipped'
  sublabel?:  string
  /** Indent depth in pixels. */
  depth:      number
  /** Active phase highlight. */
  isCurrent:  boolean
}

export function StepTimeline({ project, milestones, activity, effectiveProgress }: Props) {
  const pathwayKey = project.kind === 'audit' ? 'audit' : 'redesign'
  const phaseMap = pathwayKey === 'audit' ? PHASE_MILESTONES_AUDIT : PHASE_MILESTONES_REDESIGN
  const stepNames = WEB_MILESTONE_STEP_NAMES[pathwayKey]
  const submittedStepNumbers = useMemo(
    () => new Set(milestones.map(m => m.step_number).filter((n): n is number => n != null)),
    [milestones],
  )
  const currentPhase = activity.phase

  // Cowork step counts from roadmap_state (project-wide). The
  // CurrentActivityBar already shows which is active; here we need
  // ALL 11 with done/active/upcoming tones for the timeline.
  const coworkDone = useMemo(() => {
    const roadmap = (project.roadmap_state ?? {}) as Record<string, unknown>
    return computeCoworkDoneSet(roadmap)
  }, [project.roadmap_state])

  const [expandedPhases, setExpandedPhases] = useState<Set<WebProjectPhase>>(
    () => new Set([currentPhase]),
  )

  const togglePhase = (p: WebProjectPhase) => {
    setExpandedPhases(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p); else next.add(p)
      return next
    })
  }

  // Build the row list — flat, with depth metadata for indentation.
  const rows: TimelineRow[] = []
  const currentPhaseIdx = PHASE_ORDER.indexOf(currentPhase)
  for (let i = 0; i < PHASE_ORDER.length; i++) {
    const phase = PHASE_ORDER[i]
    const phaseStatus: TimelineRow['status'] =
      i < currentPhaseIdx ? 'done'
    : i === currentPhaseIdx ? 'active'
                            : 'upcoming'
    const phaseProgress = effectiveProgress[phase] ?? 0
    const phaseSub = phaseProgress > 0 && phaseProgress < 1
      ? `${Math.round(phaseProgress * 100)}% complete`
      : undefined
    rows.push({
      kind: 'phase', key: `phase-${phase}`,
      label: PHASE_LABEL[phase], sublabel: phaseSub,
      status: phaseStatus, depth: 0,
      isCurrent: phase === currentPhase,
    })
    if (!expandedPhases.has(phase)) continue

    // Milestone children. Only the FIRST unsubmitted milestone in the
    // active phase gets `active` + `isCurrent` so the timeline reads
    // "this one is next" — previously every unsubmitted milestone got
    // marked active and every row showed the spinner glyph, which
    // read as "the data is still loading."
    const milestoneSteps = phaseMap[phase] ?? []
    let activeMilestoneClaimed = false
    for (const stepNum of milestoneSteps) {
      const stepName = stepNames?.[stepNum] ?? `Step ${stepNum}`
      const submitted = submittedStepNumbers.has(stepNum)
      let status: TimelineRow['status']
      let isCurrent = false
      if (submitted) {
        status = 'done'
      } else if (phaseStatus === 'done') {
        status = 'skipped'
      } else if (phaseStatus === 'active' && !activeMilestoneClaimed && phase === currentPhase) {
        status = 'active'
        isCurrent = true
        activeMilestoneClaimed = true
      } else {
        status = 'upcoming'
      }
      rows.push({
        kind: 'milestone', key: `m-${phase}-${stepNum}`,
        label: `${stepNum}. ${stepName}`,
        status, depth: 1,
        isCurrent,
      })

      // Cowork sub-steps live INSIDE the Copywriting Phase milestone
      // (redesign step 3). Render them as a nested list under that
      // milestone row.
      if (pathwayKey === 'redesign' && stepNum === 3) {
        for (let cw = 1; cw <= COWORK_STEP_TOTAL; cw++) {
          const isDone = coworkDone.has(cw)
          const isActive = activity.signal === 'cowork_step' && activity.stepNumber === cw
          const subStatus: TimelineRow['status'] =
            isDone   ? 'done'
          : isActive ? 'active'
                     : phaseStatus === 'done' ? 'skipped'
                     : phaseStatus === 'active' ? 'upcoming'
                                                : 'upcoming'
          rows.push({
            kind: 'cowork', key: `cw-${cw}`,
            label: `${cw}. ${COWORK_STEP_LABELS[cw]}`,
            sublabel: isActive && activity.progressDone != null && activity.progressTotal != null
              ? `${activity.progressDone}/${activity.progressTotal}`
              : undefined,
            status: subStatus, depth: 2,
            isCurrent: isActive,
          })
        }
      }
    }
  }

  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated overflow-hidden">
      <div className="px-3 py-2 border-b border-wm-border bg-wm-bg flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text">
          Step timeline
        </p>
        <p className="text-[10.5px] text-wm-text-subtle">
          {pathwayKey === 'redesign' ? 'Web redesign · 9 partner milestones' : 'Web audit · 4 milestones'}
        </p>
      </div>
      <ul className="divide-y divide-wm-border">
        {rows.map(r => {
          if (r.kind === 'phase') {
            const phase = r.key.replace('phase-', '') as WebProjectPhase
            const isExpanded = expandedPhases.has(phase)
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => togglePhase(phase)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-wm-bg-hover transition-colors ${r.isCurrent ? 'bg-wm-accent/5' : ''}`}
                >
                  {isExpanded ? (
                    <ChevronDown size={13} className="text-wm-text-muted shrink-0" />
                  ) : (
                    <ChevronRight size={13} className="text-wm-text-muted shrink-0" />
                  )}
                  <StatusGlyph status={r.status} isCurrent={r.isCurrent} />
                  <span className={`text-[12.5px] font-bold ${r.isCurrent ? 'text-wm-accent-strong' : 'text-wm-text'}`}>
                    {r.label}
                  </span>
                  {r.sublabel && (
                    <span className="ml-auto text-[10.5px] font-mono text-wm-text-muted">
                      {r.sublabel}
                    </span>
                  )}
                </button>
              </li>
            )
          }
          // Milestone or cowork sub-step
          return (
            <li
              key={r.key}
              className={`flex items-center gap-2 px-3 py-1.5 ${r.isCurrent ? 'bg-wm-accent/8' : ''}`}
              style={{ paddingLeft: 12 + r.depth * 18 }}
            >
              <StatusGlyph status={r.status} isCurrent={r.isCurrent} />
              <span className={`text-[12px] ${r.status === 'done' ? 'text-wm-text-muted line-through' : r.status === 'skipped' ? 'text-wm-text-subtle italic' : r.isCurrent ? 'text-wm-text font-semibold' : 'text-wm-text'}`}>
                {r.label}
              </span>
              {r.sublabel && (
                <span className="ml-auto text-[10.5px] font-mono text-wm-text-muted">
                  {r.sublabel}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function StatusGlyph({ status, isCurrent }: { status: TimelineRow['status']; isCurrent: boolean }) {
  if (status === 'done') return <Check size={12} className="text-emerald-600 shrink-0" />
  // Active + current = filled dot with a subtle pulse halo. The old
  // Loader2 spinner read as "data is loading"; this reads as "we are
  // here right now."
  if (status === 'active' && isCurrent) {
    return (
      <span className="relative shrink-0 w-3 h-3 inline-grid place-items-center">
        <span className="absolute inset-0 rounded-full bg-wm-accent/30 animate-ping" />
        <span className="relative w-2 h-2 rounded-full bg-wm-accent" />
      </span>
    )
  }
  if (status === 'active') return <Circle size={12} className="text-wm-accent shrink-0" />
  if (status === 'skipped') return <CircleDashed size={11} className="text-wm-text-subtle shrink-0" />
  return <Circle size={10} className="text-wm-text-subtle shrink-0" />
}

// ── Cowork done-set computed from roadmap_state ───────────────────

function computeCoworkDoneSet(roadmap: Record<string, unknown>): Set<number> {
  const done = new Set<number>()
  const checks: Array<{ step: number; key: string; mode: 'meta' | 'entries' }> = [
    { step: 3, key: 'stage_1',              mode: 'meta' },
    { step: 4, key: 'ministry_model',       mode: 'meta' },
    { step: 5, key: 'acf_plan',             mode: 'meta' },
    { step: 6, key: 'site_strategy',        mode: 'meta' },
    { step: 7, key: 'page_allocation_plan', mode: 'meta' },
    { step: 8, key: 'page_outlines',        mode: 'entries' },
    { step: 9, key: 'page_drafts',          mode: 'entries' },
    { step: 10, key: 'page_critiques',      mode: 'entries' },
    { step: 11, key: 'critique_rollup',     mode: 'meta' },
  ]
  for (const c of checks) {
    const node = roadmap[c.key]
    if (!node || typeof node !== 'object') continue
    if (c.mode === 'meta') {
      const m = (node as { _meta?: { generated_at?: string } })._meta
      if (m?.generated_at) done.add(c.step)
    } else {
      // entries mode — at least one entry present marks the step as
      // "done enough to count" in the timeline glyph. (Per-page
      // exhaustion is shown in the activity bar; the timeline glyph
      // is binary: "has activity" vs "no activity yet.")
      const entries = Object.values(node as Record<string, unknown>)
      if (entries.some(v => v && typeof v === 'object' && (v as { _meta?: unknown })._meta)) {
        done.add(c.step)
      }
    }
  }
  // Steps 1 + 2 are aggregate; if 3 is done, treat them as done too
  // (3 consumes 1+2's outputs).
  if (done.has(3)) { done.add(1); done.add(2) }
  return done
}
