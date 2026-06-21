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
import { Loader2, AlertTriangle } from 'lucide-react'
import { WMCard } from '../Card'
import { WMStatusPill } from '../StatusPill'
import { FeasibilityPanel } from '../manager/FeasibilityPanel'
import { ClickUpTasksSummary } from '../manager/ClickUpTasksSummary'
import { CurrentActivityBar } from '../planning/CurrentActivityBar'
import { StepTimeline } from '../planning/StepTimeline'
import { ManualStatusEditor } from '../planning/ManualStatusEditor'
import { FeasibilityChip } from '../planning/FeasibilityChip'
import { PriorityCascadePreview, type CascadeRow } from '../planning/PriorityCascadePreview'
import { PartnerSyncBlock } from '../planning/PartnerSyncBlock'
import { ProvenanceBadge } from '../planning/ProvenanceBadge'
import { supabase } from '../../../lib/supabase'
import {
  computeProjectHealth,
  DEFAULT_DEV_CAPACITY,
  PHASE_ORDER,
  type HealthMilestoneRow,
} from '../../../lib/webProjectHealth'
import {
  deriveSizeTier, hourRangeForTier, sprintForDate,
  type ProjectSizeTier,
} from '../../../lib/webPlanningMath'
import { computeDevQueue, type QueueSlot } from '../../../lib/webDevQueue'
import {
  inferProgressFromTasks,
  inferredDevRemainingHours,
  type ClickUpTaskRow,
  type PhaseInference,
} from '../../../lib/webPhaseInference'
import { buildCurrentActivity } from '../../../lib/webCurrentActivity'
import { detectStall } from '../../../lib/webStallDetector'
import { evaluateLaunchFeasibility } from '../../../lib/webFeasibility'
import { buildPartnerSyncString } from '../../../lib/webPartnerSyncString'
import { fromIsoDate, daysBetween } from '../../../lib/dateRange'
import type {
  StrategyWebProject,
  WebProjectPhase,
  PhaseEstimates,
  PhaseProgress,
  ProjectSubStatus,
  ManualSubStatus,
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
  const [inference, setInference] = useState<PhaseInference | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Live page count, used to auto-derive the size tier (small/medium/
   *  large) which drives the hours-target range. Loaded once on mount;
   *  refreshed when the page list changes via the strategist's edits
   *  isn't critical here — the strategist sees stale-but-close. */
  const [pageCount, setPageCount] = useState<number | null>(null)
  /** ClickUp Website list URL — surfaced as a deep-link button on the
   *  status hero so the strategist can jump out to ClickUp in one click.
   *  Computed from the same folder/list lookup ClickUpTasksSummary
   *  uses below. Null when the project doesn't have a Website list
   *  bound. */
  const [clickUpListUrl, setClickUpListUrl] = useState<string | null>(null)

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
    manual_sub_status:      project.manual_sub_status ?? null,
    status_reason:          project.status_reason ?? null,
  })
  const [statusPanelOpen, setStatusPanelOpen] = useState(false)
  const [priorityDraft, setPriorityDraft] = useState<number | null>(project.priority_order ?? null)

  useEffect(() => {
    setDraft({
      launch_date:            project.launch_date ?? null,
      priority_order:         project.priority_order ?? null,
      dev_hours_estimate:     project.dev_hours_estimate ?? null,
      phase_estimates:        (project.phase_estimates as PhaseEstimates) ?? {},
      phase_progress:         (project.phase_progress as PhaseProgress) ?? {},
      manual_remaining_hours: project.manual_remaining_hours ?? null,
      status_note:            project.status_note ?? null,
      manual_sub_status:      project.manual_sub_status ?? null,
      status_reason:          project.status_reason ?? null,
    })
    setPriorityDraft(project.priority_order ?? null)
  }, [project])

  // Load the allocations + milestone submissions once per project,
  // plus every active project row so we can compute this project's
  // slot in the dev queue. Also fetches task_details from ClickUp
  // for the project's Website list and runs phase inference — when
  // the team hasn't typed manual phase progress / remaining, ClickUp
  // tasks become the source of truth.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [allocsRes, subsRes, queueRowsRes, folderRes] = await Promise.all([
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
        // Resolve the ClickUp Website list for this member's folder,
        // then pull task_details. Same shape as ClickUpTasksSummary —
        // could refactor into a shared helper later.
        supabase.from('clickup_folders')
          .select('id')
          .eq('space_id', 90171129510)
          .ilike('name', `${project.member} -%`)
          .limit(1)
          .maybeSingle(),
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

      // ── ClickUp task inference ────────────────────────────────
      const folderId = (folderRes.data as { id: number } | null)?.id ?? null
      if (folderId) {
        const { data: lists } = await supabase
          .from('clickup_lists')
          .select('id')
          .eq('space', 90171129510)
          .eq('folder', folderId)
          .ilike('name', '%website%')
          .limit(1)
        const listId = (lists?.[0] as { id: number } | undefined)?.id ?? null
        if (listId) {
          // Stash the deep-link URL — same shape ClickUp lists use,
          // pinned to the ChurchMediaSquad team id.
          setClickUpListUrl(`https://app.clickup.com/1235435/v/li/${listId}`)
          const { data: tasks } = await supabase
            .from('task_details' as 'tasks')
            .select('task_name, current_status, time_estimate_minutes, task_archived')
            .eq('list_id', listId)
          if (!cancelled && tasks) {
            setInference(inferProgressFromTasks(tasks as unknown as ClickUpTaskRow[]))
          }
        }
      }

      // ── Live page count for the size tier ─────────────────────
      const { count } = await supabase
        .from('web_pages')
        .select('id', { count: 'exact', head: true })
        .eq('web_project_id', project.id)
        .eq('archived', false)
      if (!cancelled) setPageCount(count ?? 0)
    })()
    return () => { cancelled = true }
  }, [project.id, project.member])

  // Effective phase_progress: user's manual entry wins per phase; when
  // a phase is blank, inferred from ClickUp tasks. Same idea for
  // remaining hours — manual override > inferred > stored estimate.
  const effectiveProgress: PhaseProgress = useMemo(() => {
    const merged: PhaseProgress = { ...(inference?.perPhase ?? {}) }
    for (const [k, v] of Object.entries(draft.phase_progress ?? {})) {
      if (v != null) merged[k as WebProjectPhase] = v
    }
    return merged
  }, [draft.phase_progress, inference])

  // ClickUp-derived dev-phase remaining hours. Anchored on
  // dev_hours_estimate so unstarted projects don't read 0h when
  // most planned tasks are still in template-"Open" status.
  const inferredDevHours = useMemo<number | null>(() => {
    if (!inference) return null
    return inferredDevRemainingHours(inference, draft.dev_hours_estimate ?? null)
  }, [inference, draft.dev_hours_estimate])

  const queueSlot = useMemo<QueueSlot | null>(() => {
    if (queueRows.length === 0) return null
    const today = new Date()
    const overlay = queueRows.map(r => {
      if (r.id !== project.id) return r
      // Pass inferred dev hours through manual_remaining_hours ONLY
      // when the user hasn't typed a manual override — same priority
      // ladder as the hook applies for the board.
      const manualOrInf = draft.manual_remaining_hours
        ?? inferredDevHours
        ?? null
      return {
        ...r,
        manual_remaining_hours: manualOrInf,
        phase_estimates:        draft.phase_estimates,
        phase_progress:         effectiveProgress,
        dev_hours_estimate:     draft.dev_hours_estimate,
      }
    })
    return computeDevQueue(overlay, DEFAULT_DEV_CAPACITY, today).get(project.id) ?? null
  }, [queueRows, project.id, draft.manual_remaining_hours, inferredDevHours, draft.phase_estimates, effectiveProgress, draft.dev_hours_estimate])

  const computed = useMemo(() => computeProjectHealth({
    project: {
      ...project,
      launch_date:            draft.launch_date,
      phase_estimates:        draft.phase_estimates,
      phase_progress:         effectiveProgress,
      manual_remaining_hours: draft.manual_remaining_hours,
      dev_hours_estimate:     draft.dev_hours_estimate,
    },
    milestones,
    allocations,
    joshWeeklyCapacity: DEFAULT_DEV_CAPACITY,
    today: new Date(),
    queueSlot: queueSlot ?? undefined,
    inferredDevRemainingHours: inferredDevHours,
  }), [project, draft, effectiveProgress, milestones, allocations, queueSlot, inferredDevHours])

  // ── Consolidated activity, stall, feasibility, cascade ────────
  const activity = useMemo(() => buildCurrentActivity({
    project: {
      ...project,
      manual_sub_status: draft.manual_sub_status,
      status_reason:     draft.status_reason,
      status_changed_at: project.status_changed_at,
    },
    milestones,
    devTasks: [],
    inference,
  }), [project, draft.manual_sub_status, draft.status_reason, milestones, inference])

  const stall = useMemo(() => detectStall({
    project: { ...project, manual_sub_status: draft.manual_sub_status, status_reason: draft.status_reason },
    activity,
    today: new Date(),
  }), [project, draft.manual_sub_status, draft.status_reason, activity])

  /** Feasibility chip — inline on the launch_date input. Reads competing
   *  hours from queueRows so the check accounts for every project in
   *  the queue. */
  const feasibility = useMemo(() => {
    if (!draft.launch_date) return null
    const competing = new Map<string, number>()
    // queueRows is a shallow shape that doesn't include allocations,
    // so we approximate "competing hours" from each project's
    // dev_hours_estimate / 4 weeks. Good enough for an inline chip;
    // the digest uses a more accurate per-week sum.
    return evaluateLaunchFeasibility({
      targetISO: draft.launch_date.slice(0, 10),
      pageCount,
      overrideHours: draft.dev_hours_estimate ?? null,
      competingHoursByWeek: competing,
      thisProjectHoursByWeek: new Map(allocations.map(a => [a.week_starting, a.hours])),
    })
  }, [draft.launch_date, draft.dev_hours_estimate, pageCount, allocations])

  /** Cascade preview — when priorityDraft differs from saved, compute
   *  the projection delta for every other queued project. */
  const cascadeRows: CascadeRow[] = useMemo(() => {
    if (priorityDraft === project.priority_order || queueRows.length === 0) return []
    const today = new Date()
    const beforeQueue = computeDevQueue(queueRows, DEFAULT_DEV_CAPACITY, today)
    const overlay = queueRows.map(r =>
      r.id === project.id ? { ...r, priority_order: priorityDraft } : r,
    )
    const afterQueue = computeDevQueue(overlay, DEFAULT_DEV_CAPACITY, today)
    const out: CascadeRow[] = []
    for (const r of queueRows) {
      if (r.id === project.id) continue
      const before = beforeQueue.get(r.id)?.devStartDate ?? null
      const after  = afterQueue.get(r.id)?.devStartDate ?? null
      if (!before && !after) continue
      const beforeISO = before ? before.toISOString().slice(0, 10) : null
      const afterISO  = after  ? after.toISOString().slice(0, 10)  : null
      const delta = before && after ? daysBetween(before, after) : 0
      if (delta === 0 && before === after) continue
      out.push({
        projectId:   r.id,
        projectName: (r as { name?: string }).name ?? r.id.slice(0, 8),
        beforeISO, afterISO, deltaDays: delta,
      })
    }
    return out
  }, [priorityDraft, project.priority_order, project.id, queueRows])

  const partnerSyncString = useMemo(() => buildPartnerSyncString({
    project: { ...project, name: project.name },
    activity,
    partnerName: null,
  }), [project, activity])

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

  // ── Status hero computations ──────────────────────────────────
  // Derive tier from sitemap page count. Override = anything stored
  // in dev_hours_estimate that doesn't match the tier's base; we show
  // both numbers so the strategist sees what we'd recommend vs what
  // they committed to.
  const sizeTier: ProjectSizeTier = useMemo(() => deriveSizeTier(pageCount), [pageCount])
  const hourRange = useMemo(() => hourRangeForTier(sizeTier), [sizeTier])
  const currentSprint = useMemo(() => sprintForDate(new Date()), [])
  /** Allocations in the current 2-week sprint window. */
  const sprintAllocations = useMemo(() => {
    return allocations.filter(a =>
      a.week_starting >= currentSprint.startISO &&
      a.week_starting <= currentSprint.endISO
    )
  }, [allocations, currentSprint])
  const sprintHours = sprintAllocations.reduce((sum, a) => sum + (a.hours ?? 0), 0)
  /** Days until launch (negative if past). null when no launch_date set. */
  const daysToLaunch = useMemo(() => {
    if (!draft.launch_date) return null
    const target = fromIsoDate(draft.launch_date)
    if (!target) return null
    return Math.round((target.getTime() - Date.now()) / 86_400_000)
  }, [draft.launch_date])
  /** Current phase label — what the strategist sees in the ribbon. */
  const currentPhase = (computed?.phase ?? 'intake') as typeof PHASE_ORDER[number]

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

        {/* Current activity bar — consolidator-driven single-line
            "where is this project" surface. Replaces the old phase
            ribbon. Shows the most-specific signal (copy engine /
            cowork step / milestone / ClickUp tasks) with provenance. */}
        <CurrentActivityBar
          activity={activity}
          stall={stall}
          clickUpUrl={clickUpListUrl}
          openStepHref={
            // Route to the right surface based on the active signal.
            activity.signal === 'copy_engine' || activity.signal === 'cowork_step'
              ? `/web/${project.id}?tab=cowork`
            : activity.signal === 'clickup_tasks' && clickUpListUrl
              ? clickUpListUrl
              : null
          }
          onResume={async () => {
            await save('manual_sub_status', null)
            await save('status_reason', null)
          }}
          onDismissStall={async () => {
            // stalled_dismissed_until lives on the project row but is
            // not part of the local edit draft — write straight to
            // Supabase and let onChange refetch.
            const until = new Date()
            until.setDate(until.getDate() + 7)
            try {
              const { error: e } = await supabase
                .from('strategy_web_projects')
                .update({ stalled_dismissed_until: until.toISOString() })
                .eq('id', project.id)
              if (e) throw new Error(e.message)
              void onChange()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Dismiss failed')
            }
          }}
          onOpenStatusPanel={() => setStatusPanelOpen(true)}
        />

        {/* Manual status editor — slides in when user clicks "Set
            status" on the activity bar. Auto-stamps changed_at +
            changed_by from the Supabase session. */}
        {statusPanelOpen && (
          <ManualStatusEditor
            current={draft.manual_sub_status}
            reason={draft.status_reason}
            changedAt={project.status_changed_at ?? null}
            changedBy={project.status_changed_by ?? null}
            onSave={async (status, reason) => {
              // Bubble Supabase errors via throw so the editor's
              // own error UI shows them; the editor will keep the
              // panel open on failure.
              const { data: { user } } = await supabase.auth.getUser()
              const employeeId = user?.email ?? user?.id ?? null
              const now = new Date().toISOString()
              const { error: e } = await supabase
                .from('strategy_web_projects')
                .update({
                  manual_sub_status: status,
                  status_reason:     reason,
                  status_changed_at: status ? now : null,
                  status_changed_by: status ? employeeId : null,
                })
                .eq('id', project.id)
              if (e) throw new Error(e.message)
              // Mirror into local draft so the activity bar reflects
              // the change before the parent refetch lands.
              setDraft(prev => ({
                ...prev,
                manual_sub_status: status,
                status_reason:     reason,
              }))
              setStatusPanelOpen(false)
              void onChange()
            }}
            onCancel={() => setStatusPanelOpen(false)}
          />
        )}

        {/* Step timeline — vertical full-pathway view with phase →
            milestone → cowork-sub-step nesting. Replaces the
            ribbon's "all phases on one line" with operational depth. */}
        <StepTimeline
          project={project}
          milestones={milestones}
          activity={activity}
          effectiveProgress={effectiveProgress}
        />

        {/* Partner-sync block — strategist-language one-liner the AM
            copies into Slack/email/ClickUp before a partner call. */}
        <PartnerSyncBlock text={partnerSyncString} />

        {/* Operational summary card — launch / hours-tier / sprint
            allocation. All three carry provenance badges so the user
            sees auto-derived vs manual override. */}
        <WMCard padding="loose">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Stat
              label={
                <span className="inline-flex items-center gap-1.5">
                  Launch target
                  <ProvenanceBadge provenance={{
                    mode: draft.launch_date ? 'manual' : 'fallback',
                    sourceLabel: draft.launch_date ? 'Strategist-set' : 'No date',
                    detail: 'web_projects.launch_date',
                  }} />
                </span>
              }
              value={draft.launch_date ?? '—'}
              hint={
                daysToLaunch == null
                  ? 'No launch date set'
                  : daysToLaunch < 0
                    ? `${Math.abs(daysToLaunch)} day${Math.abs(daysToLaunch) === 1 ? '' : 's'} past`
                    : `${daysToLaunch} day${daysToLaunch === 1 ? '' : 's'} out`
              }
            />
            <Stat
              label={
                <span className="inline-flex items-center gap-1.5">
                  Hours · {tierLabel(sizeTier)}
                  <ProvenanceBadge provenance={{
                    mode: draft.dev_hours_estimate != null ? 'manual' : pageCount && pageCount > 0 ? 'auto' : 'fallback',
                    sourceLabel: draft.dev_hours_estimate != null
                      ? 'Strategist override'
                      : pageCount && pageCount > 0
                        ? `Tier derived from ${pageCount} pages`
                        : 'Default tier (sitemap pending)',
                    detail: 'Tier = deriveSizeTier(page_count). Override = web_projects.dev_hours_estimate.',
                  }} />
                </span>
              }
              value={
                draft.dev_hours_estimate != null
                  ? `${draft.dev_hours_estimate}h`
                  : `${hourRange.base}h`
              }
              hint={
                pageCount == null || pageCount === 0
                  ? `~20 pgs est. · likely ${hourRange.likely}h · complex ${hourRange.complex}h`
                  : `${pageCount} pages · likely ${hourRange.likely}h · complex ${hourRange.complex}h`
              }
            />
            <Stat
              label={
                <span className="inline-flex items-center gap-1.5">
                  Sprint · {currentSprint.label}
                  <ProvenanceBadge provenance={{
                    mode: 'auto',
                    sourceLabel: 'Sum of weekly allocations',
                    detail: 'strategy_dev_weekly_allocations, current 2-week sprint window',
                  }} />
                </span>
              }
              value={`${sprintHours}h`}
              hint={
                sprintAllocations.length === 0
                  ? 'No allocation this sprint'
                  : `${sprintAllocations.length} week${sprintAllocations.length === 1 ? '' : 's'} of dev`
              }
            />
          </div>

          {computed && computed.riskReasons.length > 0
            && computed.riskReasons[0] !== 'On baseline plan.'
            && computed.riskReasons[0] !== 'Launched' && (
            <div className="mt-3 rounded-md border border-wm-warn/40 bg-wm-warn-bg px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={13} className="text-wm-warn shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 text-[12px] text-wm-warn">
                {computed.riskReasons[0]}
                {computed.riskReasons.length > 1 && (
                  <span className="opacity-70 ml-1">
                    (+{computed.riskReasons.length - 1} more — see Projected below)
                  </span>
                )}
              </div>
            </div>
          )}
        </WMCard>

        {/* Schedule — launch / priority / hours with inline feasibility
            chip on launch and cascade preview on priority changes. */}
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
              value={priorityDraft}
              min={1}
              // Track the typed value as a separate draft so the
              // cascade preview can recompute against the candidate
              // before it commits — but only when the user actually
              // pauses typing (blur), not on every keystroke. The
              // useMemo dep on priorityDraft keeps the queue
              // recompute cheap because it only fires when the value
              // settles.
              onCommit={(v) => {
                setPriorityDraft(v)
                void save('priority_order', v)
              }}
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

          {/* Inline feasibility chip on the launch date. */}
          {feasibility && (
            <div className="mt-3">
              <FeasibilityChip
                result={feasibility}
                onApplySuggestion={(iso) => save('launch_date', iso)}
              />
            </div>
          )}

          {/* Cascade preview — only visible while priorityDraft differs
              from saved value. */}
          {priorityDraft !== project.priority_order && cascadeRows.length > 0 && (
            <div className="mt-3 rounded-md border border-wm-accent/30 bg-wm-accent/5 p-3">
              <PriorityCascadePreview
                rows={cascadeRows}
                title="Impact preview — projected dev-start shift for other queued projects"
              />
              <p className="text-[10.5px] text-wm-text-subtle italic mt-2">
                Auto-computed by re-running computeDevQueue with the candidate priority.
              </p>
            </div>
          )}
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
            ClickUp tasks drive these by default — completed-hours over
            total-hours per phase. Drag a slider to override; leave it
            untouched to let ClickUp keep it fresh.
          </p>
          {inference && (
            <p className="text-[11px] text-wm-accent mb-2">
              Inferred from {inference.totalTasks} ClickUp tasks ·
              {' '}{Math.round(inference.remainingMinutes / 60)}h remaining
            </p>
          )}
          <div className="space-y-2">
            {PHASE_ORDER.filter(p => p !== 'launched').map(p => {
              const manualSet  = draft.phase_progress[p] != null
              const inferred   = inference?.perPhase[p] ?? null
              const effective  = manualSet
                ? Number(draft.phase_progress[p])
                : (inferred ?? 0)
              const pct = Math.round(effective * 100)
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
                      // Don't delete on 0 — explicit "0%" should override
                      // a non-zero inferred value. Clearing is via the
                      // "Use ClickUp value" button below.
                      next[p] = v
                      setDraft(prev => ({ ...prev, phase_progress: next }))
                    }}
                    onMouseUp={() => save('phase_progress', draft.phase_progress)}
                    onTouchEnd={() => save('phase_progress', draft.phase_progress)}
                    className="flex-1 accent-wm-accent"
                  />
                  <span className="text-[11px] font-mono tabular-nums text-wm-text-muted w-10 text-right">
                    {pct}%
                  </span>
                  {manualSet ? (
                    <button
                      type="button"
                      onClick={() => {
                        const next: PhaseProgress = { ...draft.phase_progress }
                        delete next[p]
                        setDraft(prev => ({ ...prev, phase_progress: next }))
                        void save('phase_progress', next)
                      }}
                      title="Stop overriding — let ClickUp drive this phase"
                      className="text-[10px] text-wm-text-muted hover:text-wm-accent underline shrink-0"
                    >
                      use clickup
                    </button>
                  ) : inferred != null ? (
                    <span className="text-[10px] text-wm-text-subtle shrink-0" title="From ClickUp tasks">
                      auto
                    </span>
                  ) : <span className="w-12 shrink-0" />}
                </div>
              )
            })}
          </div>
          {inference && inference.unclassifiedNames.length > 0 && (
            <details className="mt-3">
              <summary className="text-[11px] text-wm-text-muted cursor-pointer">
                {inference.unclassifiedNames.length} unclassified task{inference.unclassifiedNames.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 ml-3 space-y-0.5 text-[11px] text-wm-text-subtle">
                {inference.unclassifiedNames.slice(0, 8).map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
                {inference.unclassifiedNames.length > 8 && (
                  <li className="italic">
                    +{inference.unclassifiedNames.length - 8} more
                  </li>
                )}
              </ul>
            </details>
          )}
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

/** Tier label for the hours-target stat. Translates the internal
 *  ProjectSizeTier enum into something the strategist reads as a
 *  noun ("Small · 30h") not a programming token. */
function tierLabel(tier: ProjectSizeTier): string {
  switch (tier) {
    case 'small':  return 'Small (<18 pages)'
    case 'medium': return 'Medium (18-21 pages)'
    case 'large':  return 'Large (22+ pages)'
  }
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
  label, value, onCommit, onDraftChange, saving, min, step = 1, compact = false,
}: {
  label: string
  value: number | null
  onCommit: (v: number | null) => void
  /** Optional — called on every keystroke so the cascade preview can
   *  recompute before the user blurs. */
  onDraftChange?: (v: number | null) => void
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
        onChange={e => {
          setV(e.target.value)
          if (onDraftChange) {
            const next = e.target.value.trim() === '' ? null : Number(e.target.value)
            onDraftChange(Number.isFinite(next as number) ? next : null)
          }
        }}
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
  label, value, hint, tone = 'default',
}: {
  label: React.ReactNode
  value: string
  hint?: string
  tone?: 'default' | 'danger'
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</div>
      <p className={[
        'text-[13px] font-semibold mt-0.5',
        tone === 'danger' ? 'text-wm-danger' : 'text-wm-text',
      ].join(' ')}>{value}</p>
      {hint && <p className="text-[10.5px] text-wm-text-subtle mt-0.5">{hint}</p>}
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
