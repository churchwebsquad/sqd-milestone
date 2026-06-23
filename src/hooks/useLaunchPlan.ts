/**
 * useLaunchPlan — single source of truth for the launch planner.
 *
 * Reads:
 *   - strategy_web_projects (every active project; we filter excluded
 *     in the scheduler itself based on current_phase)
 *   - strategy_dev_weekly_allocations (org-wide per-week adjustments
 *     after v90: help_hours, designer_out, is_blackout)
 *
 * Exposes:
 *   - sites:       SchedulerSite[] (raw projects mapped to scheduler shape)
 *   - rows:        ProjectLaunchRow[] (joined with church_name + activity)
 *   - adjustments: WeekAdjustment[]
 *   - schedule:    Record<projectId, SiteSchedule>
 *   - recovery:    Record<projectId, RecoveryResult> for behind-target sites
 *   - cfg:         SchedulerConfig (anchored to today's Monday by default)
 *
 * Mutators:
 *   - reorderPriority(orderedIds)
 *   - setProjectField(id, patch)
 *   - upsertWeekAdjustment({ week_starting, help_hours?, designer_out?, is_blackout?, reason? })
 *   - applyRecoveryHelp(perWeek)  // bulk upsert of help_hours
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  computeSchedule, statusFromPhase, mondayOf, fmtISO,
  DEFAULT_CONFIG,
  type SchedulerSite, type WeekAdjustment, type SchedulerConfig,
  type SiteSchedule,
} from '../lib/launchScheduler'
import { solveAllHelp, type RecoveryResult } from '../lib/launchRecoverySolver'
import type { StrategyWebProject, StrategyDevWeeklyAllocation, WebProjectPhase } from '../types/database'

export interface ProjectLaunchRow extends StrategyWebProject {
  church_name:  string | null
}

export interface UseLaunchPlanReturn {
  sites:         SchedulerSite[]
  rows:          ProjectLaunchRow[]
  adjustments:   WeekAdjustment[]
  schedule:      Record<string, SiteSchedule>
  recovery:      Record<string, RecoveryResult>
  cfg:           SchedulerConfig
  loading:       boolean
  error:         string | null
  refetch:       () => Promise<void>
  reorderPriority:    (orderedIds: string[]) => Promise<void>
  setProjectField:    (id: string, patch: Partial<StrategyWebProject>) => Promise<void>
  upsertWeekAdjustment: (a: WeekAdjustment) => Promise<void>
  applyRecoveryHelp:  (perWeek: Record<number, number>) => Promise<void>
}

export function useLaunchPlan(): UseLaunchPlanReturn {
  // Anchor the schedule on today's Monday so the visible weeks line
  // up with the user's calendar.
  const cfg = useMemo<SchedulerConfig>(() => {
    const todayUtc = new Date()
    const monday = mondayOf(new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate())))
    return { ...DEFAULT_CONFIG, schedule_start: fmtISO(monday) }
  }, [])

  const [rows, setRows] = useState<ProjectLaunchRow[]>([])
  const [adjustments, setAdjustments] = useState<WeekAdjustment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [projectsRes, adjRes, accountsRes] = await Promise.all([
        supabase
          .from('strategy_web_projects')
          .select('*')
          .eq('archived', false),
        supabase
          .from('strategy_dev_weekly_allocations')
          .select('week_starting, help_hours, designer_out, is_blackout, base_capacity_override, reason'),
        supabase
          .from('strategy_account_progress')
          .select('member, church_name'),
      ])
      if (projectsRes.error) throw new Error(projectsRes.error.message)
      if (adjRes.error)      throw new Error(adjRes.error.message)
      const projects = (projectsRes.data ?? []) as StrategyWebProject[]
      const accounts = (accountsRes.data ?? []) as Array<{ member: number; church_name: string | null }>
      const accountByMember = new Map(accounts.map(a => [a.member, a.church_name]))
      setRows(projects.map(p => ({
        ...p,
        church_name: accountByMember.get(p.member as number) ?? p.church_name ?? null,
      })))
      type Row = StrategyDevWeeklyAllocation & { base_capacity_override?: number | string | null }
      setAdjustments(((adjRes.data ?? []) as Row[]).map(a => ({
        week_starting: a.week_starting,
        help_hours:    Number(a.help_hours ?? 0),
        designer_out:  !!a.designer_out,
        is_blackout:   !!a.is_blackout,
        base_capacity: a.base_capacity_override != null ? Number(a.base_capacity_override) : null,
      })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load launch plan')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refetch() }, [refetch])

  // Map rows → SchedulerSite (scheduler-shape). Priority falls back to
  // a large index for unranked rows so they sort last. A manual
  // sub-status of 'paused' takes precedence over the phase-derived
  // status — paused projects are excluded from active scheduling.
  const sites = useMemo<SchedulerSite[]>(() => rows.map((r, i) => {
    const phaseStatus = statusFromPhase(r.current_phase as WebProjectPhase)
    const status = r.manual_sub_status === 'paused' ? 'paused' as const : phaseStatus
    return {
      id:                r.id,
      priority:          r.priority_order ?? (10_000 + i),
      status,
      planned_dev_hours: Number(r.dev_hours_estimate ?? 60),
      tracked_hours:     Number(r.tracked_hours ?? 0),
      pct_complete:      r.pct_complete != null ? Number(r.pct_complete) : null,
      target_launch:     r.launch_date,
      hard_deadline:     r.hard_deadline,
      // Default to 'dev-only' when unset (per v92 schema default).
      // The PM explicitly opts in to designer-recoverable per project.
      recovery_mode:     r.recovery_mode === 'designer' ? 'designer' : 'dev-only',
      help_hours_needed: Number(r.help_hours_needed ?? 0),
    }
  }), [rows])

  // Re-run scheduler + recovery solver whenever the inputs change.
  const schedule = useMemo(() => {
    const helpMap: Record<number, number> = {}
    const designerOut: Record<number, boolean> = {}
    const blackout: Record<number, boolean> = {}
    const baseCap: Record<number, number> = {}
    const monday = mondayOf(new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    )))
    for (const a of adjustments) {
      const aWeek = new Date(`${a.week_starting}T00:00:00Z`)
      const idx = Math.round((mondayOf(aWeek).getTime() - monday.getTime()) / (7 * 86_400_000))
      if (idx < 0) continue
      if (a.help_hours > 0)        helpMap[idx]     = a.help_hours
      if (a.designer_out)          designerOut[idx] = true
      if (a.is_blackout)           blackout[idx]    = true
      if (a.base_capacity != null && a.base_capacity >= 0) baseCap[idx] = a.base_capacity
    }
    return computeSchedule(sites, helpMap, designerOut, blackout, cfg, baseCap)
  }, [sites, adjustments, cfg])

  const recovery = useMemo(() => solveAllHelp(sites, schedule, adjustments, cfg), [sites, schedule, adjustments, cfg])

  // ── Mutators ────────────────────────────────────────────────────

  const reorderPriority = useCallback(async (orderedIds: string[]) => {
    const updates = orderedIds.map((id, i) =>
      supabase.from('strategy_web_projects')
        .update({ priority_order: i + 1, updated_at: new Date().toISOString() })
        .eq('id', id),
    )
    await Promise.all(updates)
    await refetch()
  }, [refetch])

  const setProjectField = useCallback(async (id: string, patch: Partial<StrategyWebProject>) => {
    await supabase.from('strategy_web_projects')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    await refetch()
  }, [refetch])

  const upsertWeekAdjustment = useCallback(async (a: WeekAdjustment) => {
    // Delete the row entirely when it's reset to the default state.
    if (a.help_hours === 0
        && !a.designer_out
        && !a.is_blackout
        && (a.base_capacity == null)) {
      await supabase.from('strategy_dev_weekly_allocations')
        .delete()
        .eq('week_starting', a.week_starting)
      await refetch()
      return
    }
    await supabase.from('strategy_dev_weekly_allocations')
      .upsert({
        week_starting:          a.week_starting,
        help_hours:             a.help_hours,
        designer_out:           a.designer_out,
        is_blackout:            a.is_blackout,
        base_capacity_override: a.base_capacity ?? null,
        updated_at:             new Date().toISOString(),
      }, { onConflict: 'week_starting' })
    await refetch()
  }, [refetch])

  const applyRecoveryHelp = useCallback(async (perWeek: Record<number, number>) => {
    // Bulk upsert: ADD the per-week deltas on top of existing rows.
    const monday = mondayOf(new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    )))
    const existingByIso = new Map(adjustments.map(a => [a.week_starting, a]))
    const upserts: Array<{
      week_starting: string; help_hours: number;
      designer_out: boolean; is_blackout: boolean;
      base_capacity_override: number | null;
      updated_at: string
    }> = []
    for (const [idxStr, delta] of Object.entries(perWeek)) {
      const idx = Number(idxStr)
      const wk = new Date(monday.getTime() + idx * 7 * 86_400_000)
      const iso = fmtISO(wk)
      const existing = existingByIso.get(iso)
      upserts.push({
        week_starting:          iso,
        help_hours:             (existing?.help_hours ?? 0) + delta,
        designer_out:           existing?.designer_out ?? false,
        is_blackout:            existing?.is_blackout ?? false,
        base_capacity_override: existing?.base_capacity ?? null,
        updated_at:             new Date().toISOString(),
      })
    }
    if (upserts.length > 0) {
      await supabase.from('strategy_dev_weekly_allocations')
        .upsert(upserts, { onConflict: 'week_starting' })
    }
    await refetch()
  }, [adjustments, refetch])

  return {
    sites, rows, adjustments, schedule, recovery, cfg,
    loading, error, refetch,
    reorderPriority, setProjectField, upsertWeekAdjustment, applyRecoveryHelp,
  }
}
