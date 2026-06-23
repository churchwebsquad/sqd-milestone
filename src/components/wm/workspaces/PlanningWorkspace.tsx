/**
 * Web Manager — Planning workspace tab inside /web/:projectId.
 *
 * Lives at /web/:projectId?tab=planning. Renders this project's slice
 * of the org-wide launch plan + the project-specific activity signals
 * (current step, manual status, partner sync, ClickUp tasks).
 *
 * The PLANNING surface itself lives at /web — this tab is the
 * project-specific lens. Editing target launch / dev hours / recovery
 * mode here writes the same columns the /web QueueTable edits.
 *
 * Sections in render order:
 *   1. Header — name + current activity pill
 *   2. Launch slot card — target / projected / Δ / sprint span /
 *      priority position. Inline editors for launch_date,
 *      dev_hours_estimate, recovery_mode, hard_deadline.
 *   3. Recovery callout — when this project is behind target.
 *   4. Tracked time + Sync from ClickUp.
 *   5. Manual status — manual_sub_status / status_reason override.
 *   6. Current activity bar — strategist-language "where this is."
 *   7. Step timeline — cowork pipeline + milestone submissions.
 *   8. Partner sync sentence — for AM messaging.
 *   9. ClickUp · Website list — task summary table.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Flag, ExternalLink } from 'lucide-react'
import { WMCard } from '../Card'
import { WMStatusPill } from '../StatusPill'
import { CurrentActivityBar } from '../planning/CurrentActivityBar'
import { StepTimeline } from '../planning/StepTimeline'
import { ManualStatusEditor } from '../planning/ManualStatusEditor'
import { PartnerSyncBlock } from '../planning/PartnerSyncBlock'
import { ClickUpTasksSummary } from '../manager/ClickUpTasksSummary'
import { useLaunchPlan } from '../../../hooks/useLaunchPlan'
import { paceOf, weekStart, calBtw, parseD } from '../../../lib/launchScheduler'
import { buildCurrentActivity } from '../../../lib/webCurrentActivity'
import { detectStall } from '../../../lib/webStallDetector'
import { buildPartnerSyncString } from '../../../lib/webPartnerSyncString'
import { supabase } from '../../../lib/supabase'
import type { StrategyWebProject, ManualSubStatus } from '../../../types/database'

interface Props {
  project:  StrategyWebProject
  onChange: () => void | Promise<void>
}

export function PlanningWorkspace({ project, onChange }: Props) {
  const plan = useLaunchPlan()
  const [statusPanelOpen, setStatusPanelOpen] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The launch plan loads every active project; pluck this one.
  const site = plan.sites.find(s => s.id === project.id)
  const slot = plan.schedule[project.id]
  const rec  = plan.recovery[project.id]

  // Activity consolidator (still works — reads milestones, cowork state,
  // ClickUp, manual override). Local copy keyed on the project prop.
  const [milestones, setMilestones] = useState<Array<{ milestone_id: number; milestone_status: string; submitted_at: string | null; squad: string | null; pathway: string | null; step_number: number | null }>>([])
  const [coworkState, setCoworkState] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [milestonesRes, coworkRes] = await Promise.all([
        supabase
          .from('strategy_milestone_submissions')
          .select('milestone_id, milestone_status, submitted_at, milestone:strategy_milestone_definitions(squad, pathway, step_number)')
          .eq('member', project.member as number)
          .order('submitted_at', { ascending: false })
          .limit(50),
        supabase
          .from('strategy_web_projects')
          .select('roadmap_state')
          .eq('id', project.id)
          .maybeSingle(),
      ])
      if (cancelled) return
      type Raw = { milestone_id: number; milestone_status: string; submitted_at: string | null; milestone?: { squad?: string | null; pathway?: string | null; step_number?: number | null } | Array<{ squad?: string | null; pathway?: string | null; step_number?: number | null }> | null }
      setMilestones(((milestonesRes.data ?? []) as Raw[]).map(m => {
        const def = Array.isArray(m.milestone) ? m.milestone[0] : m.milestone
        return {
          milestone_id:     m.milestone_id,
          milestone_status: m.milestone_status,
          submitted_at:     m.submitted_at,
          squad:            def?.squad       ?? null,
          pathway:          def?.pathway     ?? null,
          step_number:      def?.step_number ?? null,
        }
      }))
      setCoworkState((coworkRes.data?.roadmap_state ?? null) as Record<string, unknown> | null)
    })()
    return () => { cancelled = true }
  }, [project.id, project.member])

  const activity = useMemo(() => buildCurrentActivity({
    project,
    milestones,
    coworkState,
    inference: null,
  }), [project, milestones, coworkState])
  const stall = useMemo(() => detectStall({ project, activity, today: new Date() }), [project, activity])
  const partnerSync = useMemo(() => buildPartnerSyncString({
    project: { ...project, name: project.name },
    activity,
    partnerName: null,
  }), [project, activity])

  const save = useCallback(async <K extends keyof StrategyWebProject>(key: K, value: StrategyWebProject[K]) => {
    setSavingKey(String(key))
    try {
      await plan.setProjectField(project.id, { [key]: value })
      void onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingKey(null)
    }
  }, [project.id, onChange, plan])

  const isLate    = slot?.delta != null && slot.delta < 0
  const isWaiting = site?.status === 'waiting_feedback'
  const launched  = project.current_phase === 'launched'
  const pace      = site ? paceOf(site) : null

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-5">

        {/* ─── Header ──────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs font-bold text-wm-accent-strong uppercase tracking-widest mb-1">Planning</p>
            <h1 className="text-2xl font-semibold text-wm-text">
              {project.church_name ?? project.name}
            </h1>
            <p className="text-sm text-wm-text-muted mt-1 max-w-xl">
              This project's slice of the org-wide launch plan. The full queue lives on{' '}
              <a href="/web" className="text-wm-accent hover:underline">/web</a>.
            </p>
          </div>
          <StatusBadge launched={launched} isWaiting={isWaiting} isLate={isLate} />
        </header>

        {error && (
          <div className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">{error}</div>
        )}

        {/* ─── Launch slot card ─────────────────────────────────── */}
        <WMCard padding="loose">
          <SectionLabel>Launch slot</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Stat
              label="Queue position"
              value={project.priority_order != null ? `#${project.priority_order}` : 'Unranked'}
              hint={launched ? 'Launched — out of queue.'
                  : isWaiting ? 'Waiting on partner feedback — not consuming hours.'
                  : 'Drag in /web to reorder.'}
            />
            <Stat
              label="Sprint span"
              value={slot && !launched && !isWaiting
                ? sprintLabel(slot.startWeek, slot.endWeek)
                : '—'}
              hint={slot?.devCompleteDate && !isWaiting
                ? `Dev complete ${fmtDate(slot.devCompleteDate)}`
                : ''}
            />
          </div>

          {/* Target vs projected */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Target launch (the partner's promise)" saving={savingKey === 'launch_date'}>
              <input
                type="date"
                value={project.launch_date ?? ''}
                onChange={e => void save('launch_date', e.target.value || null)}
                className="mt-1 w-full text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
              />
            </Field>
            <div className="rounded-md border border-wm-accent/30 bg-wm-accent/5 p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent">Projected launch</p>
              <p className="text-[18px] font-semibold text-wm-text mt-1">
                {launched ? 'Launched'
                  : isWaiting ? 'Waiting feedback'
                  : slot?.launchDate ? fmtDate(slot.launchDate)
                  : '—'}
              </p>
              {slot?.delta != null && !isWaiting && !launched && (
                <p className={`text-[12px] mt-1 font-semibold ${
                  slot.delta < 0 ? 'text-red-700' : slot.delta <= 7 ? 'text-amber-700' : 'text-emerald-700'
                }`}>
                  {slot.delta < 0 ? `${Math.abs(slot.delta)}d behind target` : `+${slot.delta}d ahead of target`}
                </p>
              )}
            </div>
          </div>

          {/* Hours + recovery */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Dev hours (planned)" saving={savingKey === 'dev_hours_estimate'}>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={project.dev_hours_estimate ?? 60}
                  onChange={e => void save('dev_hours_estimate', e.target.value === '' ? null : Number(e.target.value))}
                  onBlur={() => void save('dev_hours_source', 'manual')}
                  className="w-20 text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated font-mono focus:border-wm-accent focus:outline-none"
                />
                <span className={`text-[9px] uppercase tracking-widest font-bold ${
                  project.dev_hours_source === 'clickup' ? 'text-emerald-700' : 'text-wm-text-subtle'
                }`}>
                  {project.dev_hours_source === 'clickup' ? '● ClickUp synced' : '○ Manual'}
                </span>
              </div>
            </Field>
            <Field label="Recovery mode" saving={savingKey === 'recovery_mode'}>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => void save('recovery_mode', 'designer')}
                  className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full border ${
                    project.recovery_mode === 'designer'
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                      : 'border-wm-border bg-wm-bg-elevated text-wm-text-muted hover:border-emerald-300'
                  }`}
                >
                  🎨 designer
                </button>
                <button
                  type="button"
                  onClick={() => void save('recovery_mode', 'dev-only')}
                  className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full border ${
                    project.recovery_mode === 'dev-only'
                      ? 'border-purple-gray bg-cream text-deep-plum'
                      : 'border-wm-border bg-wm-bg-elevated text-wm-text-muted hover:border-purple-gray'
                  }`}
                >
                  🔒 dev-only
                </button>
              </div>
            </Field>
            <Field label="Hard deadline (optional)" saving={savingKey === 'hard_deadline'}>
              <div className="flex items-center gap-1 mt-1">
                <Flag size={12} className="text-amber-700 shrink-0" />
                <input
                  type="date"
                  value={project.hard_deadline ?? ''}
                  onChange={e => void save('hard_deadline', e.target.value || null)}
                  className="flex-1 text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none"
                />
              </div>
            </Field>
          </div>

          {/* Recovery callout */}
          {rec && rec.state !== 'on_time' && !isWaiting && !launched && (
            <div className="mt-4">
              <RecoveryCallout rec={rec} cfg={plan.cfg} onApplyHelp={plan.applyRecoveryHelp} />
            </div>
          )}
        </WMCard>

        {/* ─── Tracked time + ClickUp sync ─────────────────────── */}
        <WMCard padding="loose">
          <SectionLabel>Build-phase tracking</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Stat
              label="Tracked hours"
              value={`${project.tracked_hours ?? 0}h`}
              hint={project.last_synced_at
                ? `Last synced ${new Date(project.last_synced_at).toLocaleString()}`
                : 'Never synced from ClickUp.'}
            />
            <Stat
              label="Pace"
              value={pace ? `${pace.pct}%` : '—'}
              hint={pace
                ? `${project.tracked_hours}/${project.dev_hours_estimate ?? 60}h · ${pace.over > 0 ? `+${pace.over} over` : pace.over < 0 ? `${pace.over} under` : 'on est.'}`
                : 'No tracked time yet.'}
              tone={pace?.cls === 'late' ? 'danger' : 'default'}
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="text-[11px] text-wm-text-muted flex items-center gap-2">
              ClickUp Build Phase task id:
              <input
                type="text"
                value={project.clickup_build_task_id ?? ''}
                placeholder="86e1zmbgz"
                onChange={e => void save('clickup_build_task_id', e.target.value.trim() || null)}
                className="text-[11px] font-mono px-2 py-1 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none w-40"
              />
            </label>
            <button
              type="button"
              disabled={!project.clickup_build_task_id}
              onClick={async () => {
                // ClickUp tracked-time sync. The endpoint authenticates
                // via the Supabase user JWT (Bearer header) so include
                // the current session token.
                setSavingKey('sync_tracked')
                setError(null)
                try {
                  const { data: sess } = await supabase.auth.getSession()
                  const token = sess?.session?.access_token
                  if (!token) throw new Error('Not signed in — refresh and try again.')
                  const res = await fetch('/api/web/clickup-build-phase-sync', {
                    method:  'POST',
                    headers: {
                      'Content-Type':  'application/json',
                      'Authorization': `Bearer ${token}`,
                    },
                    body:    JSON.stringify({ project_id: project.id }),
                  })
                  const body = await res.json().catch(() => ({} as Record<string, unknown>))
                  if (!res.ok) {
                    const detail = typeof body.details === 'string' ? body.details
                                 : typeof body.error === 'string' ? body.error
                                 : `HTTP ${res.status}`
                    throw new Error(detail)
                  }
                  void onChange()
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Sync failed')
                } finally {
                  setSavingKey(null)
                }
              }}
              className="inline-flex items-center gap-1 h-7 px-3 rounded-md text-[11px] font-semibold bg-deep-plum text-white hover:bg-primary-purple disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingKey === 'sync_tracked' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Sync tracked time
            </button>
          </div>
        </WMCard>

        {/* ─── Manual status override ──────────────────────────── */}
        <WMCard padding="loose">
          <SectionLabel>Manual status</SectionLabel>
          <p className="text-[11px] text-wm-text-muted mb-2">
            Override the auto-derived sub-status when the project is paused, blocked, or waiting on the partner.
          </p>
          {!statusPanelOpen ? (
            <button
              type="button"
              onClick={() => setStatusPanelOpen(true)}
              className="text-[12px] font-semibold text-wm-accent hover:underline"
            >
              {project.manual_sub_status
                ? `Override: ${project.manual_sub_status}${project.status_reason ? ` — ${project.status_reason}` : ''}`
                : '+ Set manual status'}
            </button>
          ) : (
            <ManualStatusEditor
              current={project.manual_sub_status ?? null}
              reason={project.status_reason ?? null}
              changedAt={project.status_changed_at ?? null}
              changedBy={project.status_changed_by ?? null}
              onSave={async (status, reason) => {
                const { data: { user } } = await supabase.auth.getUser()
                const employeeId = user?.email ?? user?.id ?? null
                const now = new Date().toISOString()
                await plan.setProjectField(project.id, {
                  manual_sub_status: status as ManualSubStatus | null,
                  status_reason:     reason,
                  status_changed_at: status ? now : null,
                  status_changed_by: status ? employeeId : null,
                })
                setStatusPanelOpen(false)
                void onChange()
              }}
              onCancel={() => setStatusPanelOpen(false)}
            />
          )}
        </WMCard>

        {/* ─── Current activity ────────────────────────────────── */}
        <CurrentActivityBar
          activity={activity}
          stall={stall}
          clickUpUrl={null}
          openStepHref={null}
          onResume={async () => {
            await plan.setProjectField(project.id, { manual_sub_status: null, status_reason: null })
            void onChange()
          }}
          onDismissStall={async () => {
            const until = new Date()
            until.setDate(until.getDate() + 7)
            await plan.setProjectField(project.id, { stalled_dismissed_until: until.toISOString() })
            void onChange()
          }}
          onOpenStatusPanel={() => setStatusPanelOpen(true)}
        />

        {/* ─── Step timeline ───────────────────────────────────── */}
        <StepTimeline
          project={project}
          milestones={milestones}
          coworkState={coworkState}
        />

        {/* ─── Partner sync sentence ───────────────────────────── */}
        <PartnerSyncBlock text={partnerSync} />

        {/* ─── ClickUp · Website list ──────────────────────────── */}
        <ClickUpTasksSummary project={project} />
      </div>
    </div>
  )
}

// ── Small components ─────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2">{children}</p>
  )
}

function Field({
  label, children, saving,
}: { label: string; children: React.ReactNode; saving?: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle flex items-center gap-1">
        {label} {saving && <Loader2 size={9} className="animate-spin" />}
      </span>
      {children}
    </label>
  )
}

function Stat({
  label, value, hint, tone = 'default',
}: { label: React.ReactNode; value: string; hint?: string; tone?: 'default' | 'danger' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</p>
      <p className={`text-[14px] font-semibold mt-0.5 ${tone === 'danger' ? 'text-wm-danger' : 'text-wm-text'}`}>
        {value}
      </p>
      {hint && <p className="text-[10.5px] text-wm-text-subtle mt-0.5">{hint}</p>}
    </div>
  )
}

function StatusBadge({ launched, isWaiting, isLate }: { launched: boolean; isWaiting: boolean; isLate: boolean }) {
  if (launched) return <WMStatusPill tone="neutral" size="md">Launched</WMStatusPill>
  if (isWaiting) return <WMStatusPill tone="warning" size="md">Waiting feedback</WMStatusPill>
  if (isLate)   return <WMStatusPill tone="danger" size="md">Behind target</WMStatusPill>
  return <WMStatusPill tone="success" size="md">In progress</WMStatusPill>
}

function RecoveryCallout({
  rec, cfg, onApplyHelp,
}: {
  rec: import('../../../lib/launchRecoverySolver').RecoveryResult
  cfg: import('../../../lib/launchScheduler').SchedulerConfig
  onApplyHelp: (perWeek: Record<number, number>) => Promise<void>
}) {
  if (rec.state === 'recoverable' && rec.perWeek && rec.helpHours) {
    const weeks = Object.entries(rec.perWeek)
      .map(([idx, h]) => ({ idx: Number(idx), h }))
      .sort((a, b) => a.idx - b.idx)
      .map(w => `wk ${fmtDate(weekStart(w.idx, cfg))}: +${w.h}h`)
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start justify-between gap-2">
        <p className="text-[11.5px] text-amber-900">
          <strong>{rec.behind}d behind.</strong> Recoverable: add{' '}
          <strong>{rec.helpHours} help hrs</strong> (≈{(rec.helpHours / 7).toFixed(1)} designer-days) in {weeks.join(' · ')} →
          launches <strong>{fmtDate(rec.date)}</strong>, within target.
        </p>
        <button
          type="button"
          onClick={() => void onApplyHelp(rec.perWeek ?? {})}
          className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-deep-plum text-white text-[11px] font-semibold hover:bg-primary-purple"
        >
          Apply help
        </button>
      </div>
    )
  }
  if (rec.state === 'locked') {
    return (
      <div className="rounded-md border border-purple-gray/30 bg-cream px-3 py-2">
        <p className="text-[11.5px] text-purple-gray">
          <strong>{rec.behind}d behind.</strong>{' '}
          {rec.reason === 'dev-only'
            ? 'Work is developer-only — can\'t offload.'
            : 'Designer unavailable in the weeks that feed this site.'}{' '}
          Projected launch <strong>{fmtDate(rec.date)}</strong> stands — renegotiate the target,
          reprioritize, or add a second developer.
        </p>
      </div>
    )
  }
  if (rec.state === 'insufficient' && rec.perWeek) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 flex items-start justify-between gap-2">
        <p className="text-[11.5px] text-red-900">
          <strong>{rec.behind}d behind.</strong> Even {rec.helpHours} help hrs isn't enough — best achievable
          date is <strong>{fmtDate(rec.date)}</strong> ({rec.stillLate}d still late).
        </p>
        <button
          type="button"
          onClick={() => void onApplyHelp(rec.perWeek ?? {})}
          className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-red-400 text-red-800 text-[11px] font-semibold hover:bg-red-100"
        >
          Apply best-effort help
        </button>
      </div>
    )
  }
  return null
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function sprintLabel(startWeek: number, endWeek: number): string {
  const s = Math.floor(startWeek / 2) + 1
  const e = Math.floor(endWeek / 2) + 1
  return s === e ? `S${s}` : `S${s}–S${e}`
}
