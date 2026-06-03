/**
 * Per-project feasibility analyzer.
 *
 * Renders inside the ProjectEditPanel as a separate section. The
 * strategist enters a target launch date the AM is proposing; the
 * panel runs computeProjectFeasibility and surfaces:
 *
 *   • Verdict pill (achievable / tight / unachievable)
 *   • Bottleneck phase + remaining hours + available hours
 *   • Reasoning bullets (verbatim from the analyzer)
 *   • Levers list, each clickable to add its day-impact to a running
 *     "with levers" projection
 *
 * No commits here — the panel is read-only analysis. Strategist
 * applies the chosen levers via the regular ProjectEditPanel fields
 * (AI multipliers, page count, etc.) once they've decided.
 */
import { useEffect, useMemo, useState } from 'react'
import { WMStatusPill } from '../StatusPill'
import {
  computeProjectFeasibility,
  type FeasibilityResult,
  type Lever,
} from '../../../lib/webProjectFeasibility'
import { fromIsoDate, daysBetween } from '../../../lib/dateRange'
import type {
  StrategyWebProject,
} from '../../../types/database'
import { DEFAULT_DEV_CAPACITY, type HealthMilestoneRow } from '../../../lib/webProjectHealth'

interface Props {
  project:     Pick<
    StrategyWebProject,
    'id' | 'current_phase' | 'launch_date' | 'phase_estimates' |
    'ai_assist_multipliers' | 'dev_hours_estimate' | 'archived'
  >
  milestones:  HealthMilestoneRow[]
  allocations: Array<{ week_starting: string; hours: number }>
  pageCount?:  number
  completedProjectCount?: number
  /** When supplied, the feasibility math respects queue position
   *  (devEndDate beats the optimistic per-project projection). */
  queueSlot?:  {
    devStartDate:      string
    devEndDate:        string
    hoursBeforeStart:  number
    remainingDevHours: number
  } | null
}

const VERDICT_TONE: Record<FeasibilityResult['verdict'],
  Parameters<typeof WMStatusPill>[0]['tone']
> = {
  achievable:   'success',
  tight:        'warning',
  unachievable: 'danger',
}

const VERDICT_LABEL: Record<FeasibilityResult['verdict'], string> = {
  achievable:   'Achievable',
  tight:        'Tight',
  unachievable: 'Unachievable',
}

export function FeasibilityPanel({
  project, milestones, allocations, pageCount, completedProjectCount, queueSlot,
}: Props) {
  // Persist target launch per-project in localStorage so the value
  // survives reloads. The target is a per-project conversation tool
  // (what the AM is asking about), so per-project scope is the right
  // resolution. Per-user-per-browser is fine — this is staff-only.
  const targetStorageKey = `wm:feasibility_target:${project.id}`
  const [target, setTarget] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(targetStorageKey)
      if (saved) return saved
    }
    const d = fromIsoDate(project.launch_date)
    if (!d) return ''
    // Default to two weeks BEFORE the current launch_date so the
    // strategist sees a useful "can we pull this in" answer instead
    // of trivially-achievable.
    d.setDate(d.getDate() - 14)
    return d.toISOString().slice(0, 10)
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (target) window.localStorage.setItem(targetStorageKey, target)
    else window.localStorage.removeItem(targetStorageKey)
  }, [target, targetStorageKey])
  const [pulled, setPulled] = useState<Set<string>>(new Set())

  const result = useMemo<FeasibilityResult | null>(() => {
    if (!target) return null
    return computeProjectFeasibility({
      project,
      milestones,
      allocations,
      joshWeeklyCapacity: DEFAULT_DEV_CAPACITY,
      today: new Date(),
      targetDate: target,
      pageCount,
      completedProjectCount,
      queueSlot: queueSlot ?? undefined,
    })
  }, [target, project, milestones, allocations, pageCount, completedProjectCount, queueSlot])

  const pulledLevers: Lever[] = result
    ? result.leversAvailable.filter(l => pulled.has(l.lever))
    : []
  const totalDaysSaved = pulledLevers.reduce((sum, l) => sum + l.impactDays, 0)
  const adjustedProjection = result?.projectedLaunch
    ? (() => {
        const d = fromIsoDate(result.projectedLaunch)
        if (!d) return null
        d.setDate(d.getDate() - totalDaysSaved)
        return d
      })()
    : null
  const targetDate = fromIsoDate(target)
  const adjustedGap = (adjustedProjection && targetDate)
    ? daysBetween(adjustedProjection, targetDate)
    : null

  return (
    <section>
      <p className="text-[10px] uppercase tracking-[0.08em] font-bold text-wm-text-subtle mb-2">
        Feasibility check
      </p>
      <p className="text-[11px] text-wm-text-muted mb-3">
        Enter a target date the AM is proposing. The analyzer runs the current plan
        against it and lists levers that could pull the launch earlier.
      </p>

      <label className="block mb-3">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Target launch
        </span>
        <input
          type="date"
          value={target}
          onChange={e => setTarget(e.target.value)}
          className="mt-1 w-full text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
        />
      </label>

      {result && (
        <div className="rounded-md border border-wm-border bg-wm-bg p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <WMStatusPill tone={VERDICT_TONE[result.verdict]} size="md">
              {VERDICT_LABEL[result.verdict]}
            </WMStatusPill>
            <span className="text-[10px] text-wm-text-muted">
              Confidence: <span className="font-semibold text-wm-text">{result.confidence}</span>
            </span>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <Stat label="Current projection"
                  value={fmtIso(result.projectedLaunch)} />
            <Stat label="Target gap"
                  value={typeof result.targetGapDays === 'number'
                    ? `${result.targetGapDays >= 0 ? '+' : ''}${result.targetGapDays}d`
                    : '—'}
                  tone={result.targetGapDays != null && result.targetGapDays < 0 ? 'danger' : 'default'} />
            <Stat label="Remaining hours"
                  value={`${result.remainingHoursAdjusted}h`} />
            <Stat label="Allocated to target"
                  value={`${result.availableHoursToTarget}h`} />
            <Stat label="Bottleneck"
                  value={result.bottleneckPhase ?? '—'} />
            <Stat label="With levers"
                  tone={adjustedGap != null && adjustedGap < 0 ? 'danger' : 'default'}
                  value={adjustedProjection
                    ? `${adjustedProjection.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${adjustedGap! >= 0 ? '+' : ''}${adjustedGap}d)`
                    : '—'} />
          </div>

          {/* Reasoning */}
          {result.reasoning.length > 0 && (
            <ul className="text-[11px] text-wm-text-muted space-y-0.5">
              {result.reasoning.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          )}

          {/* Levers */}
          {result.leversAvailable.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
                Levers (click to simulate)
              </p>
              <ul className="space-y-1.5">
                {result.leversAvailable.map(l => {
                  const active = pulled.has(l.lever)
                  return (
                    <li key={l.lever}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(pulled)
                          if (active) next.delete(l.lever); else next.add(l.lever)
                          setPulled(next)
                        }}
                        className={[
                          'w-full text-left rounded-md border p-2 transition-colors',
                          active
                            ? 'border-wm-accent bg-wm-accent-tint'
                            : 'border-wm-border bg-wm-bg-elevated hover:border-wm-border-focus',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className={[
                            'text-[12px] font-semibold',
                            active ? 'text-wm-accent-strong' : 'text-wm-text',
                          ].join(' ')}>
                            {l.description}
                          </p>
                          <span className={[
                            'text-[11px] font-mono tabular-nums shrink-0',
                            active ? 'text-wm-accent-strong' : 'text-wm-text-muted',
                          ].join(' ')}>
                            −{l.impactDays}d
                          </span>
                        </div>
                        {l.risk && (
                          <p className="text-[10px] mt-0.5 text-wm-warning">
                            Risk: {l.risk.replace('_', ' ')}
                          </p>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Stat({
  label, value, tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'danger'
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</p>
      <p className={[
        'text-[13px] font-semibold mt-0.5',
        tone === 'danger' ? 'text-wm-danger' : 'text-wm-text',
      ].join(' ')}>{value}</p>
    </div>
  )
}

function fmtIso(iso: string | null): string {
  const d = fromIsoDate(iso)
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
