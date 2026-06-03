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
  DEFAULT_DEV_CAPACITY,
  PHASE_ORDER,
  type HealthMilestoneRow,
} from '../../../lib/webProjectHealth'
import { computeDevQueue, type QueueSlot } from '../../../lib/webDevQueue'
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
  const [queueRows, setQueueRows] = useState<Parameters<typeof computeDevQueue>[0]>([])
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

  // Load the allocations + milestone submissions once per project,
  // plus every active project row so we can compute this project's
  // slot in the dev queue. The slot drives the launch projection in
  // the same way the board's hook does.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [allocsRes, subsRes, queueRowsRes] = await Promise.all([
        supabase.from('strategy_dev_weekly_allocations')
          .select('week_starting, hours')
          .eq('web_project_id', project.id),
        supabase.from('strategy_milestone_submissions')
          .select(`
            milestone_id, milestone_status, submitted_at,
            milestone:strategy_milestone_definitions ( squad, pathway, step_number )
          `)
          .eq('member', project.member)
          .eq('is_active', true),
        supabase.from('strategy_web_projects')
          .select('id, priority_order, archived, current_phase, manual_remaining_hours, phase_estimates, phase_progress, dev_hours_estimate')
          .eq('archived', false),
      ])
      if (cancelled) return
      setAllocations((allocsRes.data ?? []) as Array<{ week_starting: string; hours: number }>)
      type Raw = HealthMilestoneRow & {
        milestone?: { squad?: string | null; pathway?: string | null; step_number?: number | null }
                  | Array<{ squad?: string | null; pathway?: string | null; step_number?: number | null }>
                  | null
      }
      const enriched = ((subsRes.data ?? []) as Raw[]).map(s => {
        const def = Array.isArray(s.milestone) ? s.milestone[0] : s.milestone
        return {
          milestone_id:     s.milestone_id,
          milestone_status: s.milestone_status,
          submitted_at:     s.submitted_at,
          squad:            def?.squad       ?? null,
          pathway:          def?.pathway     ?? null,
          step_number:      def?.step_number ?? null,
        } satisfies HealthMilestoneRow
      })
      setMilestones(enriched)
      setQueueRows((queueRowsRes.data ?? []) as Parameters<typeof computeDevQueue>[0])
    })()
    return () => { cancelled = true }
  }, [project.id, project.member])

  // Recompute the queue every render with the draft applied to THIS
  // project's row — keeps the projection card honest while the user
  // drags sliders or types in manual remaining hours. Without this
  // overlay the queue would lag the draft until next refetch.
  const queueSlot = useMemo<QueueSlot | null>(() => {
    if (queueRows.length === 0) return null
    const today = new Date()
    const overlay = queueRows.map(r => r.id === project.id ? {
      ...r,
      manual_remaining_hours: draft.manual_remaining_hours,
      phase_estimates:        draft.phase_estimates,
      phase_progress:         draft.phase_progress,
      dev_hours_estimate:     draft.dev_hours_estimate,
    } : r)
    return computeDevQueue(overlay, DEFAULT_DEV_CAPACITY, today).get(project.id) ?? null
  }, [queueRows, project.id, draft])

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
    joshWeeklyCapacity: DEFAULT_DEV_CAPACITY,
    today: new Date(),
    queueSlot: queueSlot ?? undefined,
  }), [project, draft, milestones, allocations, queueSlot])

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

        {/* Dev queue — sequential capacity walk across the org */}
        {queueSlot && (
          <WMCard padding="loose">
            <SectionLabel>Dev queue position</SectionLabel>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <Stat label="Queue position"
                    value={queueSlot.priority != null ? `P${queueSlot.priority}` : 'Unranked'} />
              <Stat label="Hours ahead in queue"
                    value={`${queueSlot.hoursBeforeStart}h`} />
              <Stat label="Dev starts"
                    value={new Date(fromIsoDate(queueSlot.devStartDate)!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
              <Stat label="Design must finish by"
                    value={new Date(fromIsoDate(queueSlot.designDeadline)!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
            </div>
            <p className="mt-2 text-[11px] text-wm-text-muted">
              The dev picks up projects in priority order. The launch projection below
              reflects this slot — earlier queue work has to finish first.
            </p>
          </WMCard>
        )}

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

        {/* Weekly allocations — override the auto-queue per week
            when the team needs to (vacation cover, urgent ask, etc.) */}
        <WMCard padding="loose">
          <SectionLabel>Weekly allocations</SectionLabel>
          <p className="text-[11px] text-wm-text-muted mb-3">
            Optional. Override the auto-queue for specific weeks — leave
            blank to let priority order decide. Hours typed here count
            toward "allocated to target."
          </p>
          <AllocationGrid
            projectId={project.id}
            allocations={allocations}
            onSaved={(rows) => setAllocations(rows)}
          />
        </WMCard>

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
            queueSlot={queueSlot}
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

// ── Allocation grid ──────────────────────────────────────────
// Editable per-week hours field, scoped to this project. Writes to
// strategy_dev_weekly_allocations. Each row is one week; entering 0
// or clearing the field removes the allocation. The grid shows the
// next 8 weeks by default — long enough to plan a launch, short
// enough to fit in the panel.
const ALLOC_WEEKS = 8
const ALLOC_SLOT: 'primary' = 'primary'

function AllocationGrid({
  projectId, allocations, onSaved,
}: {
  projectId:   string
  allocations: Array<{ week_starting: string; hours: number }>
  onSaved:     (rows: Array<{ week_starting: string; hours: number }>) => void
}) {
  const today = new Date()
  const weeks: string[] = []
  const start = new Date(today)
  // Snap to Monday-of-current-week (matches existing dateRange.weekStart logic).
  const dow = start.getDay()
  const offset = dow === 0 ? -6 : 1 - dow
  start.setDate(start.getDate() + offset)
  for (let i = 0; i < ALLOC_WEEKS; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i * 7)
    weeks.push(d.toISOString().slice(0, 10))
  }
  const byWeek = new Map(allocations.map(a => [a.week_starting, Number(a.hours)]))

  const save = async (week: string, hours: number | null) => {
    // Upsert or delete via Supabase.
    if (hours == null || hours <= 0) {
      await supabase.from('strategy_dev_weekly_allocations')
        .delete()
        .eq('web_project_id', projectId)
        .eq('week_starting', week)
        .eq('slot', ALLOC_SLOT)
    } else {
      await supabase.from('strategy_dev_weekly_allocations')
        .upsert({
          web_project_id: projectId,
          week_starting:  week,
          slot:           ALLOC_SLOT,
          hours,
        }, { onConflict: 'week_starting,web_project_id,slot' })
    }
    // Refetch to keep parent state honest.
    const { data } = await supabase
      .from('strategy_dev_weekly_allocations')
      .select('week_starting, hours')
      .eq('web_project_id', projectId)
    onSaved(((data ?? []) as Array<{ week_starting: string; hours: number }>))
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {weeks.map(w => (
        <AllocationCell
          key={w}
          weekIso={w}
          hours={byWeek.get(w) ?? null}
          onCommit={(h) => save(w, h)}
        />
      ))}
    </div>
  )
}

function AllocationCell({
  weekIso, hours, onCommit,
}: {
  weekIso: string
  hours:   number | null
  onCommit: (hours: number | null) => void
}) {
  const [v, setV] = useState(hours == null ? '' : String(hours))
  useEffect(() => { setV(hours == null ? '' : String(hours)) }, [hours])
  const wk = new Date(weekIso + 'T00:00:00')
  const label = wk.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <label className="block rounded-md border border-wm-border bg-wm-bg-elevated p-2">
      <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
        Week of {label}
      </span>
      <div className="flex items-baseline gap-1 mt-1">
        <input
          type="number"
          min={0}
          step={0.25}
          value={v}
          onChange={e => setV(e.target.value)}
          onBlur={() => {
            const trimmed = v.trim()
            const next = trimmed === '' ? null : Number(trimmed)
            if (next !== hours) onCommit(Number.isFinite(next as number) ? next : null)
          }}
          placeholder="0"
          className="flex-1 min-w-0 text-[13px] px-1.5 py-1 rounded border border-wm-border bg-wm-bg font-mono tabular-nums focus:border-wm-accent focus:outline-none"
        />
        <span className="text-[10px] text-wm-text-subtle">h</span>
      </div>
    </label>
  )
}
