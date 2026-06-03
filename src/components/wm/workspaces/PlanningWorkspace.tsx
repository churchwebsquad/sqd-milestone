/**
 * Web Manager — Planning workspace tab inside /web/:projectId.
 *
 * Lives at /web/:projectId?tab=planning. Renders the same per-project
 * scheduling controls the standalone ProjectEditPanel used to host as
 * a slide-out flyout from the /web board. Consolidates the two
 * surfaces so clicking a project from /web jumps straight into its
 * workspace at the Planning tab — no more dual side-panel + workspace
 * confusion.
 *
 * Sections:
 *   • Header pill — live sub-status from computeProjectHealth
 *   • Schedule — launch_date, priority_order, dev_hours_estimate
 *   • Phase budget — per-phase hour baselines (5 fields)
 *   • Phase progress — % complete slider per phase
 *   • Override + status note — manual_remaining_hours + status_note
 *   • Projected — computed launch projection + risk reasons
 *   • Feasibility — target-date analyzer (FeasibilityPanel)
 *   • ClickUp · Website list — ClickUpTasksSummary
 *
 * Saves field-by-field on blur using the same setValue pattern the
 * other workspaces use. onChange() fires after every save so the
 * parent re-fetches the project row.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { WMCard } from '../Card'
import { WMStatusPill } from '../StatusPill'
import { FeasibilityPanel } from '../manager/FeasibilityPanel'
import { ClickUpTasksSummary } from '../manager/ClickUpTasksSummary'
import { supabase } from '../../../lib/supabase'
import {
  computeProjectHealth,
  PHASE_ORDER,
  type HealthMilestoneRow,
} from '../../../lib/webProjectHealth'
import { fromIsoDate } from '../../../lib/dateRange'
import type {
  StrategyWebProject,
  WebProjectPhase,
  PhaseEstimates,
  PhaseProgress,
  ProjectSubStatus,
} from '../../../types/database'

interface Props {
  project:  StrategyWebProject
  onChange: () => void | Promise<void>
}

const PHASE_LABEL: Record<WebProjectPhase, string> = {
  intake: 'Intake', content: 'Copywriting', design: 'Design',
  dev: 'Dev', review: 'Final review', launched: 'Launched',
}

const SUB_LABEL: Record<ProjectSubStatus, string> = {
  on_track:  'On track',  ahead:    'Ahead',
  off_track: 'Off track', blocked:  'Blocked',
  complete:  'Complete',
}
const SUB_TONE: Record<ProjectSubStatus, Parameters<typeof WMStatusPill>[0]['tone']> = {
  on_track:  'success',
  ahead:     'turquoise',
  off_track: 'warning',
  blocked:   'danger',
  complete:  'neutral',
}

export function PlanningWorkspace({ project, onChange }: Props) {
  const [milestones, setMilestones] = useState<HealthMilestoneRow[]>([])
  const [allocations, setAllocations] = useState<Array<{ week_starting: string; hours: number }>>([])
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Local edit buffer driven off the project prop. Re-syncs when the
  // parent's project ref changes (after onChange refetch).
  const [draft, setDraft] = useState({
    launch_date:            project.launch_date ?? null,
    priority_order:         project.priority_order ?? null,
    dev_hours_estimate:     project.dev_hours_estimate ?? null,
    phase_estimates:        (project.phase_estimates as PhaseEstimates) ?? {},
    phase_progress:         (project.phase_progress as PhaseProgress) ?? {},
    manual_remaining_hours: project.manual_remaining_hours ?? null,
    status_note:            project.status_note ?? null,
  })

  useEffect(() => {
    setDraft({
      launch_date:            project.launch_date ?? null,
      priority_order:         project.priority_order ?? null,
      dev_hours_estimate:     project.dev_hours_estimate ?? null,
      phase_estimates:        (project.phase_estimates as PhaseEstimates) ?? {},
      phase_progress:         (project.phase_progress as PhaseProgress) ?? {},
      manual_remaining_hours: project.manual_remaining_hours ?? null,
      status_note:            project.status_note ?? null,
    })
  }, [project])

  // Load the allocations + milestone submissions once per project.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [allocsRes, subsRes] = await Promise.all([
        supabase.from('strategy_dev_weekly_allocations')
          .select('week_starting, hours')
          .eq('web_project_id', project.id),
        supabase.from('strategy_milestone_submissions')
          .select('milestone_id, milestone_status, submitted_at')
          .eq('member', project.member)
          .eq('is_active', true),
      ])
      if (cancelled) return
      setAllocations((allocsRes.data ?? []) as Array<{ week_starting: string; hours: number }>)
      setMilestones((subsRes.data ?? []) as HealthMilestoneRow[])
    })()
    return () => { cancelled = true }
  }, [project.id, project.member])

  const computed = useMemo(() => computeProjectHealth({
    project: {
      ...project,
      launch_date:            draft.launch_date,
      phase_estimates:        draft.phase_estimates,
      phase_progress:         draft.phase_progress,
      manual_remaining_hours: draft.manual_remaining_hours,
      dev_hours_estimate:     draft.dev_hours_estimate,
    },
    milestones,
    allocations,
    joshWeeklyCapacity: 30,
    today: new Date(),
  }), [project, draft, milestones, allocations])

  const save = useCallback(async <K extends keyof typeof draft>(
    key: K, value: (typeof draft)[K],
  ) => {
    setDraft(prev => ({ ...prev, [key]: value }))
    setSavingKey(String(key))
    try {
      const { error: updErr } = await supabase
        .from('strategy_web_projects')
        .update({ [key]: value })
        .eq('id', project.id)
      if (updErr) throw new Error(updErr.message)
      void onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingKey(null)
    }
  }, [project.id, onChange])

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-bold text-wm-accent-strong uppercase tracking-widest mb-1">Planning</p>
            <h1 className="text-2xl font-semibold text-wm-text">Scheduling + capacity</h1>
            <p className="text-sm text-wm-text-muted mt-1 max-w-xl">
              Tune the launch date, hours, and per-phase progress. The
              feasibility check + computed projection update live as
              you edit.
            </p>
          </div>
          {computed && (
            <WMStatusPill tone={SUB_TONE[computed.subStatus]} size="md">
              {SUB_LABEL[computed.subStatus]}
            </WMStatusPill>
          )}
        </header>

        {error && (
          <div className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
            {error}
          </div>
        )}

        {/* Schedule */}
        <WMCard padding="loose">
          <SectionLabel>Schedule</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <FieldDate
              label="Launch date"
              value={draft.launch_date}
              onCommit={(v) => save('launch_date', v)}
              saving={savingKey === 'launch_date'}
            />
            <FieldNumber
              label="Priority"
              value={draft.priority_order}
              min={1}
              onCommit={(v) => save('priority_order', v)}
              saving={savingKey === 'priority_order'}
            />
            <FieldNumber
              label="Total dev hours"
              value={draft.dev_hours_estimate}
              min={0}
              step={1}
              onCommit={(v) => save('dev_hours_estimate', v)}
              saving={savingKey === 'dev_hours_estimate'}
            />
          </div>
        </WMCard>

        {/* Phase budget */}
        <WMCard padding="loose">
          <SectionLabel>Phase budget (hours)</SectionLabel>
          <p className="text-[11px] text-wm-text-muted mb-2">
            Per-phase hour baselines. When all are zero, the health
            math falls back to Total dev hours distributed across
            remaining phases.
          </p>
          <div className="grid grid-cols-5 gap-2">
            {PHASE_ORDER.filter(p => p !== 'launched').map(p => (
              <FieldNumber
                key={p}
                label={PHASE_LABEL[p]}
                value={draft.phase_estimates[p] ?? null}
                min={0}
                step={1}
                compact
                onCommit={(v) => {
                  const next: PhaseEstimates = { ...draft.phase_estimates }
                  if (v == null || v === 0) delete next[p]
                  else next[p] = v
                  void save('phase_estimates', next)
                }}
                saving={savingKey === 'phase_estimates'}
              />
            ))}
          </div>
        </WMCard>

        {/* Phase progress */}
        <WMCard padding="loose">
          <SectionLabel>Phase progress</SectionLabel>
          <p className="text-[11px] text-wm-text-muted mb-2">
            Manual % complete per phase. Beats milestone-derived
            progress when set. Use this when work happened outside
            the milestone workflow.
          </p>
          <div className="space-y-2">
            {PHASE_ORDER.filter(p => p !== 'launched').map(p => {
              const pct = Math.round(((draft.phase_progress[p] ?? 0) * 100))
              return (
                <div key={p} className="flex items-center gap-3">
                  <span className="text-[12px] font-semibold text-wm-text w-28 shrink-0">
                    {PHASE_LABEL[p]}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={pct}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100
                      const next: PhaseProgress = { ...draft.phase_progress }
                      if (v === 0) delete next[p]
                      else next[p] = v
                      setDraft(prev => ({ ...prev, phase_progress: next }))
                    }}
                    onMouseUp={() => save('phase_progress', draft.phase_progress)}
                    onTouchEnd={() => save('phase_progress', draft.phase_progress)}
                    className="flex-1 accent-wm-accent"
                  />
                  <span className="text-[11px] font-mono tabular-nums text-wm-text-muted w-10 text-right">
                    {pct}%
                  </span>
                </div>
              )
            })}
          </div>
        </WMCard>

        {/* Manual override + status note */}
        <WMCard padding="loose">
          <SectionLabel>Manual override + status note</SectionLabel>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <FieldNumber
              label="Manual remaining hours"
              value={draft.manual_remaining_hours}
              min={0}
              step={1}
              onCommit={(v) => save('manual_remaining_hours', v)}
              saving={savingKey === 'manual_remaining_hours'}
            />
            <div className="grid place-items-center text-[10px] text-wm-text-muted italic px-2">
              When set, this beats the phase math entirely. Use it when
              you just know how much is left.
            </div>
          </div>
          <FieldTextArea
            label="Status note"
            placeholder="Where this project is right now in plain language — what's done, what's pending, what's blocking."
            value={draft.status_note}
            onCommit={(v) => save('status_note', v)}
            saving={savingKey === 'status_note'}
          />
        </WMCard>

        {/* Computed */}
        {computed && (
          <WMCard padding="loose">
            <SectionLabel>Projected</SectionLabel>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <Stat label="Projection"
                    value={computed.launchProjection
                      ? new Date(fromIsoDate(computed.launchProjection)!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'} />
              <Stat label="Target gap"
                    value={typeof computed.targetGapDays === 'number'
                      ? `${computed.targetGapDays >= 0 ? '+' : ''}${computed.targetGapDays} days`
                      : '—'}
                    tone={computed.targetGapDays != null && computed.targetGapDays < 0 ? 'danger' : 'default'} />
              <Stat label="Hours remaining"
                    value={`${computed.remainingHoursAdjusted}h`} />
              <Stat label="Allocated to target"
                    value={`${computed.availableHoursToTarget}h`} />
            </div>
            {computed.riskReasons.length > 0 && (
              <ul className="mt-3 space-y-0.5 text-[11px] text-wm-text-muted">
                {computed.riskReasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            )}
          </WMCard>
        )}

        {/* Feasibility */}
        <WMCard padding="loose">
          <FeasibilityPanel
            project={{
              id: project.id,
              current_phase: project.current_phase,
              launch_date: draft.launch_date,
              phase_estimates: draft.phase_estimates,
              ai_assist_multipliers: project.ai_assist_multipliers,
              dev_hours_estimate: draft.dev_hours_estimate,
              archived: project.archived,
              phase_progress: draft.phase_progress,
              manual_remaining_hours: draft.manual_remaining_hours,
            }}
            milestones={milestones}
            allocations={allocations}
          />
        </WMCard>

        {/* ClickUp tasks */}
        <WMCard padding="loose">
          <SectionLabel>ClickUp · Website list</SectionLabel>
          <ClickUpTasksSummary member={project.member} />
        </WMCard>
      </div>
    </div>
  )
}

// ── Small pieces ──────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.08em] font-bold text-wm-text-subtle mb-2">
      {children}
    </p>
  )
}

function FieldDate({
  label, value, onCommit, saving,
}: {
  label: string
  value: string | null
  onCommit: (v: string | null) => void
  saving?: boolean
}) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle flex items-center gap-1">
        {label} {saving && <Loader2 size={9} className="animate-spin" />}
      </span>
      <input
        type="date"
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={() => { if (v !== (value ?? '')) onCommit(v || null) }}
        className="mt-1 w-full text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
      />
    </label>
  )
}

function FieldNumber({
  label, value, onCommit, saving, min, step = 1, compact = false,
}: {
  label: string
  value: number | null
  onCommit: (v: number | null) => void
  saving?: boolean
  min?: number
  step?: number
  compact?: boolean
}) {
  const [v, setV] = useState(value == null ? '' : String(value))
  useEffect(() => { setV(value == null ? '' : String(value)) }, [value])
  return (
    <label className="block">
      <span className={[
        'text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle flex items-center gap-1',
        compact ? 'truncate' : '',
      ].join(' ')}>
        {label} {saving && <Loader2 size={9} className="animate-spin" />}
      </span>
      <input
        type="number"
        value={v}
        min={min}
        step={step}
        onChange={e => setV(e.target.value)}
        onBlur={() => {
          const next = v.trim() === '' ? null : Number(v)
          if (next !== value) onCommit(Number.isFinite(next as number) ? next : null)
        }}
        className="mt-1 w-full text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated font-mono tabular-nums focus:border-wm-accent focus:outline-none"
      />
    </label>
  )
}

function FieldTextArea({
  label, value, placeholder, onCommit, saving,
}: {
  label: string
  value: string | null
  placeholder?: string
  onCommit: (v: string | null) => void
  saving?: boolean
}) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle flex items-center gap-1">
        {label} {saving && <Loader2 size={9} className="animate-spin" />}
      </span>
      <textarea
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={() => { if (v !== (value ?? '')) onCommit(v.trim() === '' ? null : v) }}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none resize-vertical leading-snug"
      />
    </label>
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
