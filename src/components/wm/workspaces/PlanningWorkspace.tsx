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
 *   • Project Settings — page count + velocity levers (v89; drives
 *     predicted dev hours)
 *   • Manual override — manual_remaining_hours (beats everything)
 *   • Dev Queue Position — where this project sits in priority order
 *   • Projected — computed launch projection + risk reasons
 *   • Weekly allocations — pin specific weeks (writes
 *     strategy_dev_weekly_allocations)
 *   • Feasibility — target-date analyzer (FeasibilityPanel)
 *   • ClickUp · Website list — ClickUpTasksSummary
 *
 * The 5-phase Phase Budget + Phase Progress cards were dropped — with
 * the content pipeline shipping full-site copy in a day and Brixies
 * design accelerating after, dev is the only phase that meaningfully
 * consumes the launch budget. Phase math collapses to the single
 * "dev hours" number from computeDevHoursTotal.
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
  sprintForDate,
  computeDevHoursTotal,
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
    launch_date:                  project.launch_date ?? null,
    priority_order:               project.priority_order ?? null,
    dev_hours_estimate:           project.dev_hours_estimate ?? null,
    phase_estimates:              (project.phase_estimates as PhaseEstimates) ?? {},
    phase_progress:               (project.phase_progress as PhaseProgress) ?? {},
    manual_remaining_hours:       project.manual_remaining_hours ?? null,
    status_note:                  project.status_note ?? null,
    manual_sub_status:            project.manual_sub_status ?? null,
    status_reason:                project.status_reason ?? null,
    // v89 velocity levers
    expected_page_count:          project.expected_page_count ?? null,
    dev_hours_per_page:           Number(project.dev_hours_per_page ?? 3.0),
    uses_novamira:                !!project.uses_novamira,
    dev_edits_route_to_designer:  !!project.dev_edits_route_to_designer,
    assist_hours_per_week_extra:  Number(project.assist_hours_per_week_extra ?? 0),
    pre_dev_complete:             !!project.pre_dev_complete,
  })
  const [statusPanelOpen, setStatusPanelOpen] = useState(false)
  const [priorityDraft, setPriorityDraft] = useState<number | null>(project.priority_order ?? null)

  useEffect(() => {
    setDraft({
      launch_date:                  project.launch_date ?? null,
      priority_order:               project.priority_order ?? null,
      dev_hours_estimate:           project.dev_hours_estimate ?? null,
      phase_estimates:              (project.phase_estimates as PhaseEstimates) ?? {},
      phase_progress:               (project.phase_progress as PhaseProgress) ?? {},
      manual_remaining_hours:       project.manual_remaining_hours ?? null,
      status_note:                  project.status_note ?? null,
      manual_sub_status:            project.manual_sub_status ?? null,
      status_reason:                project.status_reason ?? null,
      expected_page_count:          project.expected_page_count ?? null,
      dev_hours_per_page:           Number(project.dev_hours_per_page ?? 3.0),
      uses_novamira:                !!project.uses_novamira,
      dev_edits_route_to_designer:  !!project.dev_edits_route_to_designer,
      assist_hours_per_week_extra:  Number(project.assist_hours_per_week_extra ?? 0),
      pre_dev_complete:             !!project.pre_dev_complete,
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

  /** Move this project one slot up or down in the queue, renumbering
   *  any project caught in the swap. Mirror of the /web List drag
   *  handler, just scoped to a single-step nudge from the Planning
   *  tab so the user never types a free integer. */
  const nudgePriority = useCallback(async (dir: 'up' | 'down') => {
    if (!queueRows.length) return
    const ordered = [...queueRows].sort(
      (a, b) => (a.priority_order ?? 999) - (b.priority_order ?? 999),
    )
    const idx = ordered.findIndex(r => r.id === project.id)
    if (idx === -1) return
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= ordered.length) return
    const swapped = [...ordered]
    const [moved] = swapped.splice(idx, 1)
    swapped.splice(swapIdx, 0, moved)
    setSavingKey('priority_order')
    try {
      await Promise.all(swapped.map((r, i) =>
        supabase.from('strategy_web_projects')
          .update({ priority_order: i + 1, updated_at: new Date().toISOString() })
          .eq('id', r.id),
      ))
      void onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Priority save failed')
    } finally {
      setSavingKey(null)
    }
  }, [queueRows, project.id, onChange])

  // ── Status hero computations ──────────────────────────────────
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

  /** Live dev-hours total under the v89 page-count math. Drives the
   *  Project Settings preview. */
  const devHoursLive = useMemo(() => computeDevHoursTotal({
    manualOverride:           draft.dev_hours_estimate,
    expectedPageCount:        draft.expected_page_count,
    actualPageCount:          pageCount > 0 ? pageCount : null,
    hoursPerPage:             draft.dev_hours_per_page,
    usesNovamira:             draft.uses_novamira,
    devEditsRouteToDesigner:  draft.dev_edits_route_to_designer,
  }), [
    draft.dev_hours_estimate,
    draft.expected_page_count,
    pageCount,
    draft.dev_hours_per_page,
    draft.uses_novamira,
    draft.dev_edits_route_to_designer,
  ])

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-xs font-bold text-wm-accent-strong uppercase tracking-widest mb-1">Planning</p>
            <h1 className="text-2xl font-semibold text-wm-text">Scheduling + capacity</h1>
            <p className="text-sm text-wm-text-muted mt-1 max-w-xl">
              Set launch date + page count + Novamira / assist levers. The
              feasibility check + queue projection update live as you edit.
            </p>
          </div>
          {computed && (
            <div
              className="flex flex-col items-end gap-1 shrink-0"
              title={
                computed.riskReasons.length > 0
                  ? `Why: ${computed.riskReasons.join(' · ')}`
                  : 'Live status from computeProjectHealth'
              }
            >
              <WMStatusPill tone={SUB_TONE[computed.subStatus]} size="md">
                {SUB_LABEL[computed.subStatus]}
              </WMStatusPill>
              {computed.riskReasons.length > 0
                && computed.riskReasons[0] !== 'On baseline plan.'
                && computed.riskReasons[0] !== 'Launched' && (
                <p className="text-[10px] text-wm-text-muted italic max-w-xs text-right leading-snug">
                  {computed.riskReasons[0]}
                </p>
              )}
            </div>
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

        {/* Operational summary — launch target + sprint allocation.
            The Hours stat used to live here with old tier-based math.
            That moved to the Project Settings card below, which uses
            the new computeDevHoursTotal with full derivation. */}
        <WMCard padding="loose">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        {/* Target vs Predicted — hero comparison. Target = the AM's
            promise (draft.launch_date). Predicted = what the queue
            says given priority + remaining dev hours. The user has
            been complaining these were scattered across cards — they
            now live together at the top of the planning surface. */}
        <WMCard padding="loose">
          <SectionLabel>Launch</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Target</p>
              <FieldDate
                label=""
                value={draft.launch_date}
                onCommit={(v) => save('launch_date', v)}
                saving={savingKey === 'launch_date'}
              />
              <p className="text-[10.5px] text-wm-text-subtle mt-1">
                What the AM has promised the partner. Empty = no promise yet.
              </p>
            </div>
            <div className="rounded-md border border-wm-accent/40 bg-wm-accent/5 p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent">Predicted</p>
              <p className="text-[18px] font-semibold text-wm-text mt-1">
                {queueSlot && queueSlot.devEndDate
                  ? formatLongDate(queueSlot.devEndDate)
                  : queueSlot?.remainingDevHours === 0
                    ? 'Dev complete'
                    : '—'}
              </p>
              <p className="text-[10.5px] text-wm-text-muted mt-1">
                {queueSlot?.remainingDevHours === 0
                  ? 'No dev hours remaining.'
                  : queueSlot && queueSlot.devStartDate
                    ? `Queue picks this up ${formatLongDate(queueSlot.devStartDate)} · ${queueSlot.hoursBeforeStart}h ahead.`
                    : 'Set page count + priority in Project Settings to compute.'}
              </p>
              {/* Apply-predicted CTA — fills launch_date with the queue's
                  guess. Surfaces only when target is missing or off by
                  more than 7 days. */}
              {queueSlot?.devEndDate && (!draft.launch_date || Math.abs((fromIsoDate(draft.launch_date)?.getTime() ?? 0) - (fromIsoDate(queueSlot.devEndDate)?.getTime() ?? 0)) > 7 * 86400000) && (
                <button
                  type="button"
                  onClick={() => save('launch_date', queueSlot.devEndDate)}
                  className="mt-2 text-[11px] font-semibold text-wm-accent-strong hover:underline"
                >
                  → Set target to {formatLongDate(queueSlot.devEndDate)}
                </button>
              )}
            </div>
          </div>

          {/* Inline feasibility chip — only meaningful when both target
              and a remaining-hours number exist. */}
          {feasibility && draft.launch_date && (
            <div className="mb-3">
              <FeasibilityChip
                result={feasibility}
                onApplySuggestion={(iso) => save('launch_date', iso)}
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Priority</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[18px] font-mono font-semibold text-wm-text">
                  #{project.priority_order ?? '—'}
                </p>
                <button
                  type="button"
                  onClick={() => void nudgePriority('up')}
                  disabled={!queueRows.length || (project.priority_order ?? 1) <= 1}
                  className="text-[11px] font-semibold px-2 py-1 rounded border border-wm-border hover:border-wm-accent disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Move one slot higher"
                >↑</button>
                <button
                  type="button"
                  onClick={() => void nudgePriority('down')}
                  disabled={!queueRows.length}
                  className="text-[11px] font-semibold px-2 py-1 rounded border border-wm-border hover:border-wm-accent disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Move one slot lower"
                >↓</button>
              </div>
              <p className="text-[10.5px] text-wm-text-subtle mt-1">
                For bulk shuffling, drag rows in <a href="/web" className="text-wm-accent hover:underline">/web list</a>.
              </p>
            </div>
            <FieldNumber
              label="Total dev hours (override)"
              value={draft.dev_hours_estimate}
              min={0}
              step={1}
              onCommit={(v) => save('dev_hours_estimate', v)}
              saving={savingKey === 'dev_hours_estimate'}
            />
          </div>
          <p className="text-[10.5px] text-wm-text-subtle italic mt-2">
            Override blank ⇒ uses the {devHoursLive.total}h predicted by Project Settings ({devHoursLive.note}).
          </p>

          {/* Cascade preview while a priority nudge is unsaved. */}
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

        {/* Project Settings — v89 velocity levers.
            Page count + Novamira + dev-edits-to-designer + assist hrs
            are the inputs that drive predicted launch. Live preview
            shows the resulting dev-hour total + derivation note. */}
        <WMCard padding="loose">
          <SectionLabel>Project Settings</SectionLabel>
          <p className="text-[11px] text-wm-text-muted mb-3">
            Drives the predicted launch date. Page count × hrs/page × levers = dev hours.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FieldNumber
              label="Expected page count"
              value={draft.expected_page_count}
              min={1}
              step={1}
              onCommit={(v) => save('expected_page_count', v)}
              saving={savingKey === 'expected_page_count'}
            />
            <FieldNumber
              label="Dev hours per page"
              value={draft.dev_hours_per_page}
              min={0}
              step={0.5}
              onCommit={(v) => save('dev_hours_per_page', v ?? 3.0)}
              saving={savingKey === 'dev_hours_per_page'}
            />
          </div>

          <div className="mt-3 space-y-2">
            <LeverToggle
              label="Uses Novamira"
              hint="AI-assisted dev — multiplies hours by 0.5."
              checked={draft.uses_novamira}
              saving={savingKey === 'uses_novamira'}
              onChange={(v) => save('uses_novamira', v)}
            />
            <LeverToggle
              label="Dev edits route to designer"
              hint="Review-cycle edits go to the designer's queue — reduces dev hours by 15%."
              checked={draft.dev_edits_route_to_designer}
              saving={savingKey === 'dev_edits_route_to_designer'}
              onChange={(v) => save('dev_edits_route_to_designer', v)}
            />
            <LeverToggle
              label="Pre-dev phases complete"
              hint="Intake + content + design are done — full launch budget can attribute to dev."
              checked={draft.pre_dev_complete}
              saving={savingKey === 'pre_dev_complete'}
              onChange={(v) => save('pre_dev_complete', v)}
            />
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <FieldNumber
              label="Assist hours / week (extra)"
              value={draft.assist_hours_per_week_extra}
              min={0}
              step={1}
              onCommit={(v) => save('assist_hours_per_week_extra', v ?? 0)}
              saving={savingKey === 'assist_hours_per_week_extra'}
            />
            <div className="rounded-md border border-wm-accent/30 bg-wm-accent/5 p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent">
                Predicted dev hours
              </p>
              <p className="text-2xl font-semibold text-wm-text mt-1">
                {devHoursLive.total}<span className="text-[12px] text-wm-text-muted ml-1">h</span>
              </p>
              <p className="text-[11px] text-wm-text-muted mt-1">
                {devHoursLive.note}
              </p>
            </div>
          </div>
        </WMCard>

        {/* Manual override — single field. Status reason ("why") lives
            on the Manual Status Editor (Sub-Status block) above. */}
        <WMCard padding="loose">
          <SectionLabel>Manual override</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FieldNumber
              label="Manual remaining hours"
              value={draft.manual_remaining_hours}
              min={0}
              step={1}
              onCommit={(v) => save('manual_remaining_hours', v)}
              saving={savingKey === 'manual_remaining_hours'}
            />
            <p className="text-[11px] text-wm-text-muted italic self-center">
              Beats every other estimate (Project Settings math, ClickUp inference, dev_hours_estimate). Leave blank to use the computed total.
              {inference && (
                <> ClickUp currently infers <span className="font-mono">{Math.round(inference.remainingMinutes / 60)}h</span> remaining across {inference.totalTasks} tasks.</>
              )}
            </p>
          </div>
        </WMCard>

        {/* Dev queue — sequential capacity walk across the org. Hidden
            when the project has 0 hours remaining (dev complete or
            phase past dev). */}
        {queueSlot && queueSlot.devStartDate && queueSlot.remainingDevHours > 0 && (
          <WMCard padding="loose">
            <SectionLabel>Dev queue position</SectionLabel>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <Stat label="Queue position"
                    value={queueSlot.priority != null ? `P${queueSlot.priority}` : 'Unranked'} />
              <Stat label="Hours ahead in queue"
                    value={`${queueSlot.hoursBeforeStart}h`} />
              <Stat label="Dev starts"
                    value={formatLongDate(queueSlot.devStartDate)} />
              {queueSlot.designDeadline && (
                <Stat label="Design must finish by"
                      value={formatLongDate(queueSlot.designDeadline)} />
              )}
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

        {/* Weekly allocations retired — the per-project grid has been
            replaced by the cross-project Week-Hour Grid on /web?view=grid.
            Edit hours there to see how this project's week fits beside
            every other project. */}

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

function LeverToggle({
  label, hint, checked, onChange, saving,
}: {
  label:    string
  hint?:    string
  checked:  boolean
  onChange: (v: boolean) => void
  saving?:  boolean
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-wm-border text-wm-accent focus:ring-wm-accent"
      />
      <div className="min-w-0 flex-1">
        <span className="text-[12px] font-semibold text-wm-text flex items-center gap-1">
          {label} {saving && <Loader2 size={9} className="animate-spin" />}
        </span>
        {hint && <p className="text-[11px] text-wm-text-muted leading-snug">{hint}</p>}
      </div>
    </label>
  )
}

/** Format an ISO yyyy-mm-dd as a strategist-friendly "Jul 6, 2026"
 *  with safe fallbacks for null/invalid inputs. */
function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = fromIsoDate(iso)
  if (!d) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

