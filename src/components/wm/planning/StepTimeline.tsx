/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { useMemo, useRef, useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Check, Circle, CircleDashed, RotateCcw } from 'lucide-react'
import {
  WEB_MILESTONE_STEP_NAMES,
  COWORK_STEP_LABELS,
  COWORK_STEP_TOTAL,
  type CurrentActivity,
} from '../../../lib/webCurrentActivity'
import type { StrategyWebProject, WebProjectPhase, PhaseProgress } from '../../../types/database'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HealthMilestoneRow = any

/** Status values both the auto-derivation and the override layer use. */
type RowStatus = 'done' | 'active' | 'upcoming' | 'skipped'

interface Props {
  project:    StrategyWebProject
  milestones: HealthMilestoneRow[]
  /** Output of buildCurrentActivity — used to highlight the current row. */
  activity:   CurrentActivity
  /** Manual phase_progress for "Mark phase complete" affordance. */
  effectiveProgress: PhaseProgress
  /** Persist a batch of per-row overrides. Pass null per key to clear
   *  (revert that row to auto). Batch shape lets the picker cascade
   *  earlier rows to 'done' in a single round-trip. */
  onOverride?: (updates: Record<string, RowStatus | null>) => void | Promise<void>
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
  status:     RowStatus
  /** True when this row's status came from step_timeline_overrides
   *  (not the auto signals). Drives the "manual override" badge. */
  overridden: boolean
  sublabel?:  string
  /** Indent depth in pixels. */
  depth:      number
  /** Active phase highlight. */
  isCurrent:  boolean
}

export function StepTimeline({ project, milestones, activity, effectiveProgress, onOverride }: Props) {
  const overrides = useMemo(
    () => (project.step_timeline_overrides ?? {}) as Record<string, RowStatus>,
    [project.step_timeline_overrides],
  )
  const applyOverride = (key: string, derived: RowStatus): { status: RowStatus; overridden: boolean } => {
    const ov = overrides[key]
    return ov ? { status: ov, overridden: true } : { status: derived, overridden: false }
  }
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

  // Canonical ordering of EVERY possible row key (phase → milestones
  // → cowork) regardless of which phases are currently expanded.
  // Used by the override picker to cascade "done" backwards: if the
  // user marks a later row done, everything earlier in this order
  // also gets stamped 'done'.
  const allRowKeys = useMemo(() => {
    const keys: string[] = []
    for (const phase of PHASE_ORDER) {
      keys.push(`phase:${phase}`)
      const ms = phaseMap[phase] ?? []
      for (const stepNum of ms) {
        keys.push(`milestone:${stepNum}`)
        if (pathwayKey === 'redesign' && stepNum === 3) {
          for (let cw = 1; cw <= COWORK_STEP_TOTAL; cw++) keys.push(`cowork:${cw}`)
        }
      }
    }
    return keys
  }, [pathwayKey, phaseMap])

  // Lookup table for the picker — pass-through to onOverride that
  // batches the cascade. Stays stable across renders so the picker's
  // useEffect doesn't churn.
  const handlePick = useMemo(() => async (rowKey: string, picked: RowStatus | null) => {
    if (!onOverride) return
    const updates: Record<string, RowStatus | null> = { [rowKey]: picked }
    if (picked === 'done') {
      // Cascade backwards: every row earlier in the canonical order
      // also becomes 'done'. Skips rows already overridden to 'done'
      // — no need to rewrite them.
      const idx = allRowKeys.indexOf(rowKey)
      for (let i = 0; i < idx; i++) {
        const k = allRowKeys[i]
        if (overrides[k] !== 'done') updates[k] = 'done'
      }
    }
    await onOverride(updates)
  }, [onOverride, allRowKeys, overrides])

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
    const derivedPhaseStatus: RowStatus =
      i < currentPhaseIdx ? 'done'
    : i === currentPhaseIdx ? 'active'
                            : 'upcoming'
    const phaseKey = `phase:${phase}`
    const phaseFinal = applyOverride(phaseKey, derivedPhaseStatus)
    const phaseProgress = effectiveProgress[phase] ?? 0
    const phaseSub = phaseProgress > 0 && phaseProgress < 1
      ? `${Math.round(phaseProgress * 100)}% complete`
      : undefined
    rows.push({
      kind: 'phase', key: phaseKey,
      label: PHASE_LABEL[phase], sublabel: phaseSub,
      status: phaseFinal.status,
      overridden: phaseFinal.overridden,
      depth: 0,
      isCurrent: phaseFinal.status === 'active',
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
      let derived: RowStatus
      if (submitted) {
        derived = 'done'
      } else if (derivedPhaseStatus === 'done') {
        derived = 'skipped'
      } else if (derivedPhaseStatus === 'active' && !activeMilestoneClaimed && phase === currentPhase) {
        derived = 'active'
        activeMilestoneClaimed = true
      } else {
        derived = 'upcoming'
      }
      const milestoneKey = `milestone:${stepNum}`
      const mFinal = applyOverride(milestoneKey, derived)
      rows.push({
        kind: 'milestone', key: milestoneKey,
        label: `${stepNum}. ${stepName}`,
        status: mFinal.status,
        overridden: mFinal.overridden,
        depth: 1,
        isCurrent: mFinal.status === 'active',
      })

      // Cowork sub-steps live INSIDE the Copywriting Phase milestone
      // (redesign step 3). Render them as a nested list under that
      // milestone row.
      if (pathwayKey === 'redesign' && stepNum === 3) {
        for (let cw = 1; cw <= COWORK_STEP_TOTAL; cw++) {
          const isDone = coworkDone.has(cw)
          const isActive = activity.signal === 'cowork_step' && activity.stepNumber === cw
          const derivedSub: RowStatus =
            isDone   ? 'done'
          : isActive ? 'active'
                     : derivedPhaseStatus === 'done' ? 'skipped'
                     : 'upcoming'
          const cwKey = `cowork:${cw}`
          const cwFinal = applyOverride(cwKey, derivedSub)
          rows.push({
            kind: 'cowork', key: cwKey,
            label: `${cw}. ${COWORK_STEP_LABELS[cw]}`,
            sublabel: isActive && activity.progressDone != null && activity.progressTotal != null
              ? `${activity.progressDone}/${activity.progressTotal}`
              : undefined,
            status: cwFinal.status,
            overridden: cwFinal.overridden,
            depth: 2,
            isCurrent: cwFinal.status === 'active',
          })
        }
      }
    }
  }

  return (
    // overflow-visible so the per-row override popover can escape the
    // card without being clipped. Rounded corners still clip the
    // background; only the children break out of the bounds.
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated overflow-visible">
      <div className="px-3 py-2 border-b border-wm-border bg-wm-bg flex items-center justify-between rounded-t-lg">
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text">
          Step timeline
        </p>
        <p className="text-[10.5px] text-wm-text-subtle">
          {pathwayKey === 'redesign' ? 'Web redesign · 9 partner milestones' : 'Web audit · 4 milestones'}
          {onOverride && <span className="ml-2 text-wm-text-muted">· Click status icon to override</span>}
        </p>
      </div>
      <ul className="divide-y divide-wm-border">
        {rows.map(r => {
          if (r.kind === 'phase') {
            const phase = r.key.replace('phase:', '') as WebProjectPhase
            const isExpanded = expandedPhases.has(phase)
            return (
              <li key={r.key} className={`flex items-center gap-2 px-3 py-2 hover:bg-wm-bg-hover transition-colors ${r.isCurrent ? 'bg-wm-accent/5' : ''}`}>
                <button
                  type="button"
                  onClick={() => togglePhase(phase)}
                  className="flex items-center gap-1 shrink-0"
                  aria-label={isExpanded ? 'Collapse phase' : 'Expand phase'}
                >
                  {isExpanded ? (
                    <ChevronDown size={13} className="text-wm-text-muted" />
                  ) : (
                    <ChevronRight size={13} className="text-wm-text-muted" />
                  )}
                </button>
                <StatusPicker row={r} onPick={handlePick} />
                <button
                  type="button"
                  onClick={() => togglePhase(phase)}
                  className="flex-1 text-left"
                >
                  <span className={`text-[12.5px] font-bold ${r.isCurrent ? 'text-wm-accent-strong' : 'text-wm-text'}`}>
                    {r.label}
                  </span>
                </button>
                {r.overridden && <OverrideBadge />}
                {r.sublabel && (
                  <span className="text-[10.5px] font-mono text-wm-text-muted">{r.sublabel}</span>
                )}
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
              <StatusPicker row={r} onPick={handlePick} />
              <span className={`text-[12px] ${r.status === 'done' ? 'text-wm-text-muted line-through' : r.status === 'skipped' ? 'text-wm-text-subtle italic' : r.isCurrent ? 'text-wm-text font-semibold' : 'text-wm-text'}`}>
                {r.label}
              </span>
              {r.overridden && <OverrideBadge />}
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

// ── Inline status picker ─────────────────────────────────────────

/** Click the row's status glyph → opens a tiny inline popover with
 *  the four status options + a "Reset to auto" affordance. Closes on
 *  blur or after a pick. Read-only when no onPick callback. Picks
 *  flow through to the parent's batched handler which cascades
 *  earlier rows to 'done' when appropriate. */
function StatusPicker({
  row, onPick: onPickProp,
}: { row: TimelineRow; onPick?: (rowKey: string, status: RowStatus | null) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClickAway = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [open])

  if (!onPickProp) {
    return <span className="shrink-0"><StatusGlyph status={row.status} isCurrent={row.isCurrent} /></span>
  }
  const pick = async (s: RowStatus | null) => {
    setOpen(false)
    await onPickProp(row.key, s)
  }
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="inline-flex p-0.5 rounded hover:ring-1 hover:ring-wm-accent/30 focus:outline-none focus:ring-1 focus:ring-wm-accent/40"
        title="Override status"
      >
        <StatusGlyph status={row.status} isCurrent={row.isCurrent} />
      </button>
      {open && (
        <div className="absolute z-20 left-0 top-full mt-1 rounded-md border border-wm-border bg-wm-bg-elevated shadow-md py-1 min-w-[140px]">
          <PickRow label="Done"     status="done"     active={row.status === 'done'}     onClick={() => pick('done')} />
          <PickRow label="Active"   status="active"   active={row.status === 'active'}   onClick={() => pick('active')} />
          <PickRow label="Upcoming" status="upcoming" active={row.status === 'upcoming'} onClick={() => pick('upcoming')} />
          <PickRow label="Skipped"  status="skipped"  active={row.status === 'skipped'}  onClick={() => pick('skipped')} />
          {row.overridden && (
            <>
              <div className="my-1 border-t border-wm-border" />
              <button
                type="button"
                onClick={() => pick(null)}
                className="w-full px-2 py-1 text-left text-[11.5px] text-wm-text-muted hover:bg-wm-bg-hover inline-flex items-center gap-1.5"
              >
                <RotateCcw size={11} />
                Reset to auto
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PickRow({
  label, status, active, onClick,
}: { label: string; status: RowStatus; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-2 py-1 text-left text-[12px] inline-flex items-center gap-2 hover:bg-wm-bg-hover ${active ? 'font-semibold' : ''}`}
    >
      <StatusGlyph status={status} isCurrent={status === 'active'} />
      <span className={active ? 'text-wm-accent-strong' : 'text-wm-text'}>{label}</span>
    </button>
  )
}

function OverrideBadge() {
  return (
    <span
      className="text-[9px] uppercase tracking-widest font-bold text-wm-accent-strong bg-wm-accent/10 border border-wm-accent/30 rounded-full px-1.5 py-0.5"
      title="Manually overridden by a staff member"
    >
      Manual
    </span>
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
