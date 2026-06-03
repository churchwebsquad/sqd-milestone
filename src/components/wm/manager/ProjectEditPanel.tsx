/**
 * Slide-out editor for a single web project's scheduling fields.
 *
 * Mounted by WebProjectsPage when the URL carries `?edit=<id>`. Loads
 * the project row fresh on open (in case the board's cached row is
 * stale), edits in a local buffer, saves on blur per-field. Three
 * field groups + a read-only computed block:
 *
 *   • Schedule   — launch_date, priority_order, dev_hours_estimate
 *   • Phase budget — per-phase hours (intake/content/design/dev/review)
 *   • AI assist   — per-phase multipliers (heavy / light / off presets)
 *   • Computed    — projected launch, hours remaining, risk reasons
 *
 * The Computed block re-renders as the user edits, using
 * computeProjectHealth against the in-panel buffer + the project's
 * milestones / allocations.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { WMFlyoutPanel } from '../FlyoutPanel'
import { WMSegmentedToggle } from '../SegmentedToggle'
import { WMStatusPill } from '../StatusPill'
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
  AiAssistMultipliers,
  ProjectSubStatus,
} from '../../../types/database'

interface Props {
  projectId: string | null
  onClose: () => void
  /** Called after any successful save so the parent can refetch. */
  onSaved?: () => void
}

const PHASE_LABEL: Record<WebProjectPhase, string> = {
  intake: 'Intake', content: 'Copywriting', design: 'Design',
  dev: 'Dev', review: 'Final review', launched: 'Launched',
}

// Multiplier presets shown in the AI-assist segmented toggle.
const MULTIPLIER_PRESETS = [
  { value: 0.4, label: 'Heavy AI' },
  { value: 0.7, label: 'Light AI' },
  { value: 1.0, label: 'No AI' },
] as const

const SUB_LABEL: Record<ProjectSubStatus, string> = {
  on_track:  'On track',
  ahead:     'Ahead',
  off_track: 'Off track',
  blocked:   'Blocked',
  complete:  'Complete',
}
const SUB_TONE: Record<ProjectSubStatus, Parameters<typeof WMStatusPill>[0]['tone']> = {
  on_track:  'success',
  ahead:     'turquoise',
  off_track: 'warning',
  blocked:   'danger',
  complete:  'neutral',
}

export function ProjectEditPanel({ projectId, onClose, onSaved }: Props) {
  const [project,    setProject]    = useState<StrategyWebProject | null>(null)
  const [milestones, setMilestones] = useState<HealthMilestoneRow[]>([])
  const [allocations, setAllocations] = useState<Array<{ week_starting: string; hours: number }>>([])
  const [loading,    setLoading]    = useState(false)
  const [savingKey,  setSavingKey]  = useState<string | null>(null)
  const [error,      setError]      = useState<string | null>(null)

  // Local edit buffer — used to drive the live "computed" block AND
  // saved per-field on blur.
  const [draft, setDraft] = useState<{
    launch_date:           string | null
    priority_order:        number | null
    dev_hours_estimate:    number | null
    phase_estimates:       PhaseEstimates
    ai_assist_multipliers: AiAssistMultipliers
  } | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true); setError(null)
    try {
      const [{ data: proj, error: projErr }, allocsRes, msRes] = await Promise.all([
        supabase.from('strategy_web_projects').select('*').eq('id', id).maybeSingle(),
        supabase.from('strategy_dev_weekly_allocations').select('week_starting, hours').eq('web_project_id', id),
        // milestones joined via member — we don't know the member
        // until proj loads, so this is sequenced inside the .then.
        Promise.resolve(),
      ])
      if (projErr) throw new Error(projErr.message)
      if (!proj) throw new Error('Project not found')
      const p = proj as StrategyWebProject
      setProject(p)
      setDraft({
        launch_date:           p.launch_date ?? null,
        priority_order:        p.priority_order ?? null,
        dev_hours_estimate:    p.dev_hours_estimate ?? null,
        phase_estimates:       (p.phase_estimates as PhaseEstimates) ?? {},
        ai_assist_multipliers: (p.ai_assist_multipliers as AiAssistMultipliers) ?? {},
      })
      setAllocations(((allocsRes.data ?? []) as Array<{ week_starting: string; hours: number }>))

      const { data: subs } = await supabase
        .from('strategy_milestone_submissions')
        .select('milestone_id, milestone_status, submitted_at')
        .eq('member', p.member)
        .eq('is_active', true)
        .order('submitted_at', { ascending: false })
      setMilestones((subs ?? []) as HealthMilestoneRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!projectId) {
      setProject(null); setDraft(null); setAllocations([]); setMilestones([])
      return
    }
    void load(projectId)
  }, [projectId, load])

  // Live recompute of health against the draft.
  const computed = useMemo(() => {
    if (!project || !draft) return null
    return computeProjectHealth({
      project: {
        ...project,
        launch_date:           draft.launch_date,
        phase_estimates:       draft.phase_estimates,
        ai_assist_multipliers: draft.ai_assist_multipliers,
        dev_hours_estimate:    draft.dev_hours_estimate,
      },
      milestones,
      allocations,
      joshWeeklyCapacity: 30,
      today: new Date(),
    })
  }, [project, draft, milestones, allocations])

  /** Optimistically update a field locally + write to Supabase. The
   *  page-level refetch fires on success so the row stays in sync. */
  const save = useCallback(async <K extends keyof NonNullable<typeof draft>>(
    key: K,
    value: NonNullable<typeof draft>[K],
  ) => {
    if (!project || !draft) return
    setDraft({ ...draft, [key]: value })
    setSavingKey(String(key))
    try {
      const { error: updErr } = await supabase
        .from('strategy_web_projects')
        .update({ [key]: value })
        .eq('id', project.id)
      if (updErr) throw new Error(updErr.message)
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingKey(null)
    }
  }, [project, draft, onSaved])

  if (!projectId) return null

  return (
    <WMFlyoutPanel
      open={!!projectId}
      onClose={onClose}
      width="lg"
      title={project ? project.name : 'Loading…'}
      subtitle={project ? `Member ${project.member} · ${project.kind}` : undefined}
      headerRight={computed && (
        <WMStatusPill tone={SUB_TONE[computed.subStatus]} size="sm">
          {SUB_LABEL[computed.subStatus]}
        </WMStatusPill>
      )}
    >
      {loading && (
        <div className="grid place-items-center h-40 text-wm-text-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}
      {error && (
        <div className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
          {error}
        </div>
      )}
      {!loading && draft && project && (
        <div className="space-y-6">
          {/* ── Schedule ────────────────────────────── */}
          <section>
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
          </section>

          {/* ── Phase budget ────────────────────────── */}
          <section>
            <SectionLabel>Phase budget (hours)</SectionLabel>
            <p className="text-[11px] text-wm-text-muted mb-2">
              Per-phase hour baselines. When all are zero, the health math
              falls back to "Total dev hours" distributed evenly across
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
          </section>

          {/* ── AI assist ──────────────────────────── */}
          <section>
            <SectionLabel>AI assist</SectionLabel>
            <p className="text-[11px] text-wm-text-muted mb-2">
              Cuts a phase's effective hours when AI tooling is engaged.
              Heavy = 40%, Light = 70%, Off = 100% (no help).
            </p>
            <div className="space-y-2">
              {(['content', 'design', 'dev'] as WebProjectPhase[]).map(p => {
                const current = draft.ai_assist_multipliers[p] ?? 1.0
                return (
                  <div key={p} className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold text-wm-text w-24 shrink-0">
                      {PHASE_LABEL[p]}
                    </span>
                    <WMSegmentedToggle<number>
                      value={
                        MULTIPLIER_PRESETS.find(m => Math.abs(m.value - current) < 0.05)?.value
                        ?? 1.0
                      }
                      onChange={(v) => {
                        const next: AiAssistMultipliers = { ...draft.ai_assist_multipliers }
                        if (v === 1.0) delete next[p]
                        else next[p] = v
                        void save('ai_assist_multipliers', next)
                      }}
                      options={MULTIPLIER_PRESETS.map(m => ({ value: m.value, label: m.label }))}
                    />
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── Computed ───────────────────────────── */}
          {computed && (
            <section>
              <SectionLabel>Projected</SectionLabel>
              <div className="rounded-md border border-wm-border bg-wm-bg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-[12px]">
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
                  <ul className="mt-2 space-y-0.5 text-[11px] text-wm-text-muted">
                    {computed.riskReasons.map((r, i) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </WMFlyoutPanel>
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
      ].join(' ')}>
        {value}
      </p>
    </div>
  )
}
