/**
 * Web Manager — Planning workspace tab inside /web/:projectId.
 *
 * Lives at /web/:projectId?tab=planning. The full org-wide planner is
 * /web; this tab is the project-specific lens.
 *
 * Sections in render order (matches Ashley's core list):
 *   1. Header — name + status pill
 *   2. Launch slot — projected, target (with hard-deadline flag), Δ,
 *      planned dev hours, help hours needed, design start, dev start
 *      (with Dev Sprint # + span as smaller text)
 *   3. Project status — manual sub-status override + reason
 *   4. Step timeline
 *   5. Build-phase tracked hours — from the two known dev subtask
 *      names ("Developer Prep & Build", "Testing, Revisions, Launch")
 *   6. Project manager notes
 *   7. Partner sync sentence — for AM messaging
 *   8. ClickUp · Website list — task summary table
 *
 * Paused projects (`manual_sub_status === 'paused'`) suppress the
 * projected launch and sprint span; the scheduler also excludes them
 * from the queue + sprint timeline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Flag } from 'lucide-react'
import { WMCard } from '../Card'
import { WMStatusPill } from '../StatusPill'
import { StepTimeline } from '../planning/StepTimeline'
import { ManualStatusEditor } from '../planning/ManualStatusEditor'
import { PartnerSyncBlock } from '../planning/PartnerSyncBlock'
import { ClickUpTasksSummary } from '../manager/ClickUpTasksSummary'
import { useLaunchPlan } from '../../../hooks/useLaunchPlan'
import { buildCurrentActivity } from '../../../lib/webCurrentActivity'
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
  const [pmNotesDraft, setPmNotesDraft] = useState(project.pm_notes ?? '')
  useEffect(() => { setPmNotesDraft(project.pm_notes ?? '') }, [project.pm_notes])

  const site = plan.sites.find(s => s.id === project.id)
  const slot = plan.schedule[project.id]
  const rec  = plan.recovery[project.id]

  // Milestone history feeds the partner-sync sentence + step timeline.
  const [milestones, setMilestones] = useState<Array<{ milestone_id: number; milestone_status: string; submitted_at: string | null; squad: string | null; pathway: string | null; step_number: number | null }>>([])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const milestonesRes = await supabase
        .from('strategy_milestone_submissions')
        .select('milestone_id, milestone_status, submitted_at, milestone:strategy_milestone_definitions(squad, pathway, step_number)')
        .eq('member', project.member as number)
        .order('submitted_at', { ascending: false })
        .limit(50)
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
    })()
    return () => { cancelled = true }
  }, [project.id, project.member])

  const activity = useMemo(() => buildCurrentActivity({
    project,
    milestones,
    devTasks:  [],
    inference: null,
  }), [project, milestones])
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
  const isPaused  = site?.status === 'paused'
  const launched  = project.current_phase === 'launched'

  // Design due = dev start − 2 business days. This is the date by
  // which design must be wrapped so the developer can pick the project
  // up cleanly with a 1-business-day handoff buffer.
  const designDue: Date | null = !isPaused && slot?.devStartDate
    ? new Date(subBizDaysMs(slot.devStartDate.getTime(), 2))
    : null

  const sprintLabel = !isPaused && slot
    ? formatSprintLabel(slot.startWeek, slot.endWeek, plan.cfg.sprint_weeks)
    : null
  const sprintSpan = !isPaused && slot
    ? formatSprintSpan(slot.startWeek, slot.endWeek, plan.cfg.sprint_weeks)
    : null

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ─── Header ──────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs font-bold text-wm-accent-strong uppercase tracking-widest mb-1">Planning</p>
            <h1 className="text-2xl font-semibold text-wm-text">
              {project.church_name ?? project.name}
            </h1>
            <p className="text-xs font-mono text-wm-text-subtle mt-1">#{project.member}</p>
          </div>
          <StatusBadge launched={launched} isWaiting={isWaiting} isLate={isLate} isPaused={isPaused} />
        </header>

        {error && (
          <div className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">{error}</div>
        )}

        {/* ─── Launch slot ─────────────────────────────────────── */}
        <WMCard padding="loose">
          <SectionLabel>Launch slot</SectionLabel>

          {/* Top row: Projected · Target · Δ */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-md border border-wm-accent/30 bg-wm-accent/5 p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent">Projected launch</p>
              <p className="text-[18px] font-semibold text-wm-text mt-1">
                {isPaused    ? 'Paused'
                 : launched  ? 'Launched'
                 : slot?.launchDate ? fmtDate(slot.launchDate)
                 : '—'}
              </p>
            </div>
            <Field label="Target launch" saving={savingKey === 'launch_date' || savingKey === 'hard_deadline'}>
              {/* Reads "Sep 4, 2026" but edits via the native date
                  picker — explicit showPicker() so Firefox/Safari open
                  the picker on click (not just Chrome). */}
              <DatePickerChip
                value={project.launch_date ?? null}
                onChange={iso => void save('launch_date', iso)}
                placeholder="— pick a date —"
              />
              <label className={`inline-flex items-center gap-1.5 mt-1.5 text-[11px] cursor-pointer ${project.hard_deadline ? 'text-amber-800 font-semibold' : 'text-wm-text-muted'}`}>
                <input
                  type="checkbox"
                  checked={!!project.hard_deadline}
                  disabled={!project.launch_date}
                  onChange={e => void save('hard_deadline', e.target.checked ? project.launch_date : null)}
                  className="accent-amber-600"
                />
                <Flag size={11} /> Hard deadline
              </label>
            </Field>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Δ vs target</p>
              <p className={`text-[18px] font-semibold mt-1 ${
                slot?.delta == null || isPaused ? 'text-wm-text-muted'
                : slot.delta < 0 ? 'text-red-700'
                : slot.delta <= 7 ? 'text-amber-700'
                : 'text-emerald-700'
              }`}>
                {isPaused || slot?.delta == null ? '—'
                 : slot.delta < 0 ? `−${Math.abs(slot.delta)}d`
                 : `+${slot.delta}d`}
              </p>
              {slot?.delta != null && !isPaused && (
                <p className="text-[11px] text-wm-text-muted mt-0.5">
                  {slot.delta < 0 ? 'behind target' : 'ahead of target'}
                </p>
              )}
            </div>
          </div>

          {/* Hours row: Planned dev hrs · Help hrs needed */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Planned dev hours" saving={savingKey === 'dev_hours_estimate'}>
              <div className="flex items-center gap-2 mt-1">
                <BufferedNumberInput
                  value={project.dev_hours_estimate ?? 60}
                  onCommit={n => {
                    void save('dev_hours_estimate', n)
                    void save('dev_hours_source',   'manual')
                  }}
                />
                <span className={`text-[9px] uppercase tracking-widest font-bold ${
                  project.dev_hours_source === 'clickup' ? 'text-emerald-700' : 'text-wm-text-muted'
                }`}>
                  {project.dev_hours_source === 'clickup' ? '● ClickUp synced' : '○ Manual'}
                </span>
              </div>
            </Field>
            <Field label="Help hours needed" saving={savingKey === 'help_hours_needed'}>
              <div className="flex items-center gap-2 mt-1">
                <BufferedNumberInput
                  value={project.help_hours_needed ?? 0}
                  onCommit={n => void save('help_hours_needed', n)}
                />
              </div>
              <p className="text-[10.5px] text-wm-text-muted mt-1 leading-snug">
                Spread across the weeks this church is being worked on. Travels with this church if priority changes.
              </p>
            </Field>
          </div>

          {/* Dates row: Design start · Dev start (+ sprint sub-label) */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Stat
              label="Design due"
              value={designDue ? fmtDate(designDue) : '—'}
              hint={designDue ? 'Date design must be wrapped so the dev can pick this church up on time.' : ''}
            />
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Dev start</p>
              <p className="text-[14px] font-semibold text-wm-text mt-0.5">
                {isPaused      ? '—'
                 : slot?.devStartDate ? fmtDate(slot.devStartDate)
                 : '—'}
              </p>
              {sprintLabel && sprintSpan && (
                <p className="text-[10.5px] text-wm-text-muted mt-0.5 font-mono">
                  {sprintLabel} · {sprintSpan}
                </p>
              )}
            </div>
          </div>

          {/* Recovery callout */}
          {rec && rec.state !== 'on_time' && !isWaiting && !launched && !isPaused && (
            <div className="mt-4">
              <RecoveryCallout rec={rec} />
            </div>
          )}
        </WMCard>

        {/* ─── Project status ──────────────────────────────────── */}
        <WMCard padding="loose">
          <SectionLabel>Project status</SectionLabel>
          <p className="text-[11px] text-wm-text-muted mb-2">
            Override the auto-derived sub-status when the project is paused, blocked, or waiting on the partner.
            Paused projects don't take a sprint slot.
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

        {/* ─── Step timeline ───────────────────────────────────── */}
        <StepTimeline
          project={project}
          milestones={milestones}
          activity={activity}
          effectiveProgress={{}}
        />

        {/* ─── Build-phase tracked hours ───────────────────────── */}
        <WMCard padding="loose">
          <SectionLabel>Build-phase tracked time</SectionLabel>
          <p className="text-[11px] text-wm-text-muted mb-3">
            Pulls time logged against the <code className="font-mono text-[11px] text-deep-plum">Developer Prep &amp; Build</code> and{' '}
            <code className="font-mono text-[11px] text-deep-plum">Testing, Revisions, Launch</code> ClickUp tasks under the
            project's Build Phase. Tracked time only — estimates stay separate.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Stat
              label="Tracked hours"
              value={`${project.tracked_hours ?? 0}h`}
              hint={project.last_synced_at
                ? `Last synced ${new Date(project.last_synced_at).toLocaleString()}`
                : 'Never synced from ClickUp.'}
            />
            <Stat
              label="Remaining"
              value={`${Math.max(0, (project.dev_hours_estimate ?? 60) - (project.tracked_hours ?? 0))}h`}
              hint={`vs ${project.dev_hours_estimate ?? 60}h planned`}
            />
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
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

        {/* ─── Project manager notes ───────────────────────────── */}
        <WMCard padding="loose">
          <SectionLabel>Project manager notes</SectionLabel>
          <textarea
            value={pmNotesDraft}
            onChange={e => setPmNotesDraft(e.target.value)}
            onBlur={() => {
              const trimmed = pmNotesDraft.trim()
              const current = project.pm_notes ?? ''
              if (trimmed !== current) void save('pm_notes', trimmed === '' ? null : pmNotesDraft)
            }}
            rows={4}
            placeholder="Anything the team should know about this project — who's owning what, partner quirks, scope changes, etc."
            className="w-full text-[12.5px] px-3 py-2 rounded-md border border-wm-border bg-wm-bg-elevated focus:border-wm-accent focus:outline-none resize-y"
          />
          {savingKey === 'pm_notes' && (
            <p className="text-[10px] text-wm-text-subtle mt-1 inline-flex items-center gap-1">
              <Loader2 size={9} className="animate-spin" /> Saving…
            </p>
          )}
        </WMCard>

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
  label, value, hint,
}: { label: React.ReactNode; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-muted">{label}</p>
      <p className="text-[14px] font-semibold mt-0.5 text-wm-text">{value}</p>
      {hint && <p className="text-[10.5px] text-wm-text-muted mt-0.5 leading-snug">{hint}</p>}
    </div>
  )
}

/** Buffered numeric input — fixes the "60 → 6030" bug where typing
 *  into a default-populated field appended chars and shipped every
 *  keystroke to the DB. Behavior:
 *   - Focus selects all so the next keystroke replaces the value.
 *   - Edits stay in local state until blur or Enter, then commit once.
 *   - When the parent prop changes externally (refetch), the draft
 *     resyncs unless the input is currently focused. */
function BufferedNumberInput({
  value, onCommit, width = 'w-20',
}: { value: number; onCommit: (n: number) => void; width?: string }) {
  const [draft, setDraft] = useState<string>(String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setDraft(String(value)) }, [value, focused])
  const commit = () => {
    const t = draft.trim()
    if (t === '') { onCommit(0); setDraft('0'); return }
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) { setDraft(String(value)); return }
    if (n !== value) onCommit(n)
  }
  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        min={0}
        step={1}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onFocus={e => { setFocused(true); e.currentTarget.select() }}
        onBlur={() => { setFocused(false); commit() }}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          if (e.key === 'Escape') { setDraft(String(value)); (e.currentTarget as HTMLInputElement).blur() }
        }}
        className={`${width} text-[12px] px-2 py-1.5 rounded-md border border-wm-border bg-wm-bg-elevated font-mono focus:border-wm-accent focus:outline-none`}
      />
      <span className="text-[10px] text-wm-text-muted">h</span>
    </div>
  )
}

/** ISO yyyy-mm-dd → UTC midnight Date. Mirrors the scheduler's parseD
 *  so the displayed date doesn't drift by a day across local offsets. */
function parseIsoUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Displays "Sep 4, 2026" but edits via the native date picker. Uses
 *  showPicker() so Firefox/Safari open the picker on click (not just
 *  Chrome — they only honor a click on the visible calendar indicator
 *  which we don't render). */
function DatePickerChip({
  value, onChange, placeholder,
}: {
  value:       string | null
  onChange:    (iso: string | null) => void
  placeholder: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const open = () => {
    const el = ref.current
    if (!el) return
    try { el.showPicker?.() }
    catch { el.focus(); el.click() }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
      }}
      className="mt-1 w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2 py-1.5 hover:border-wm-accent/60 focus:border-wm-accent focus:outline-none cursor-pointer"
      title="Click to edit"
    >
      <span className={`block text-[13px] ${value ? 'text-wm-text' : 'text-wm-text-muted italic'}`}>
        {value ? fmtDate(parseIsoUtc(value)) : placeholder}
      </span>
      <input
        ref={ref}
        type="date"
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="sr-only"
        tabIndex={-1}
      />
    </div>
  )
}

function StatusBadge({ launched, isWaiting, isLate, isPaused }: { launched: boolean; isWaiting: boolean; isLate: boolean; isPaused: boolean }) {
  if (launched)  return <WMStatusPill tone="neutral" size="md">Launched</WMStatusPill>
  if (isPaused)  return <WMStatusPill tone="neutral" size="md">Paused</WMStatusPill>
  if (isWaiting) return <WMStatusPill tone="warning" size="md">Waiting feedback</WMStatusPill>
  if (isLate)    return <WMStatusPill tone="danger"  size="md">Behind target</WMStatusPill>
  return <WMStatusPill tone="success" size="md">In progress</WMStatusPill>
}

function RecoveryCallout({
  rec,
}: {
  rec: import('../../../lib/launchRecoverySolver').RecoveryResult
}) {
  if (rec.state === 'recoverable' && rec.helpHours) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
        <p className="text-[11.5px] text-amber-900">
          <strong>{rec.behind}d behind.</strong> Add{' '}
          <strong>{rec.helpHours} help hrs</strong> (in the Help hours needed field above)
          to land on <strong>{fmtDate(rec.date)}</strong>.
        </p>
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
  if (rec.state === 'insufficient') {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2">
        <p className="text-[11.5px] text-red-900">
          <strong>{rec.behind}d behind.</strong> Even {rec.helpHours} help hrs isn't enough —
          best achievable date is <strong>{fmtDate(rec.date)}</strong>{' '}
          ({rec.stillLate}d still late).
        </p>
      </div>
    )
  }
  return null
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function formatSprintLabel(startWeek: number, endWeek: number, sprintWeeks: number): string {
  const s = Math.floor(startWeek / sprintWeeks) + 1
  const e = Math.floor(endWeek   / sprintWeeks) + 1
  return s === e ? `Dev S${s}` : `Dev S${s}–S${e}`
}

function formatSprintSpan(startWeek: number, endWeek: number, sprintWeeks: number): string {
  // Anchor to today's Monday — matches useLaunchPlan's cfg.schedule_start.
  const now = new Date()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const wd = monday.getUTCDay()
  const off = wd === 0 ? -6 : 1 - wd
  monday.setUTCDate(monday.getUTCDate() + off)
  const dayMs = 86_400_000
  const firstSprintIdx = Math.floor(startWeek / sprintWeeks)
  const lastSprintIdx  = Math.floor(endWeek   / sprintWeeks)
  const start = new Date(monday.getTime() + firstSprintIdx * sprintWeeks * 7 * dayMs)
  const lastSprintStart = new Date(monday.getTime() + lastSprintIdx * sprintWeeks * 7 * dayMs)
  const end = new Date(lastSprintStart.getTime() + (sprintWeeks * 7 - 1) * dayMs)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${fmt(start)}–${fmt(end)}`
}

/** Subtract N business days from a UTC ms timestamp. */
function subBizDaysMs(ms: number, n: number): number {
  let d = new Date(ms)
  let left = Math.max(0, Math.round(n))
  while (left > 0) {
    d = new Date(d.getTime() - 86_400_000)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d.getTime()
}

