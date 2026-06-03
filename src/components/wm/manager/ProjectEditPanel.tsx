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
import { Loader2, ExternalLink, ListChecks } from 'lucide-react'
import { Link } from 'react-router-dom'
import { WMFlyoutPanel } from '../FlyoutPanel'
import { WMStatusPill } from '../StatusPill'
import { FeasibilityPanel } from './FeasibilityPanel'
import { ClickUpTasksSummary } from './ClickUpTasksSummary'
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
  projectId: string | null
  onClose: () => void
  /** Called after any successful save so the parent can refetch. */
  onSaved?: () => void
}

const PHASE_LABEL: Record<WebProjectPhase, string> = {
  intake: 'Intake', content: 'Copywriting', design: 'Design',
  dev: 'Dev', review: 'Final review', launched: 'Launched',
}

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
    launch_date:            string | null
    priority_order:         number | null
    dev_hours_estimate:     number | null
    phase_estimates:        PhaseEstimates
    phase_progress:         PhaseProgress
    manual_remaining_hours: number | null
    status_note:            string | null
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
        launch_date:            p.launch_date ?? null,
        priority_order:         p.priority_order ?? null,
        dev_hours_estimate:     p.dev_hours_estimate ?? null,
        phase_estimates:        (p.phase_estimates as PhaseEstimates) ?? {},
        phase_progress:         (p.phase_progress as PhaseProgress) ?? {},
        manual_remaining_hours: p.manual_remaining_hours ?? null,
        status_note:            p.status_note ?? null,
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

          {/* ── Phase progress ────────────────────── */}
          <section>
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
                    <span className="text-[12px] font-semibold text-wm-text w-24 shrink-0">
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
                        setDraft({ ...draft, phase_progress: next })
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
          </section>

          {/* ── Manual override + Status note ───────── */}
          <section>
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
          </section>

          {/* ── Workspace shortcuts ───────────────── */}
          <section>
            <SectionLabel>Open in workspace</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {[
                { tab: '',          label: 'Overview'      },
                { tab: 'intake',    label: 'Intake & Crawl' },
                { tab: 'pages',     label: 'Pages'          },
                { tab: 'design',    label: 'Design Handoff' },
                { tab: 'devhandoff', label: 'Dev Handoff'   },
                { tab: 'review',    label: 'Review'         },
              ].map(l => (
                <Link
                  key={l.tab || 'overview'}
                  to={l.tab ? `/web/${project.id}?tab=${l.tab}` : `/web/${project.id}`}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold border border-wm-border bg-wm-bg-elevated text-wm-text hover:border-wm-border-focus hover:text-wm-accent-strong transition-colors"
                >
                  {l.label}
                  <ExternalLink size={10} />
                </Link>
              ))}
            </div>
          </section>

          {/* ── ClickUp tasks summary ─────────────── */}
          <section>
            <SectionLabel>ClickUp · Website list</SectionLabel>
            <ClickUpTasksSummary member={project.member} />
          </section>

          {/* ── Feasibility check ──────────────────── */}
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
      ].join(' ')}>
        {value}
      </p>
    </div>
  )
}
