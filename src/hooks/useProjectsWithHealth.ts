/**
 * Loads every Website Manager project plus the signals
 * `computeProjectHealth` needs, and returns a derived view-model
 * the Board + Schedule views consume.
 *
 * One fetch per render — child views pluck what they need from
 * `rows`. A 60s soft re-fetch keeps the board fresh without forcing
 * a polling loop on every visible row.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  computeProjectHealth,
  DEFAULT_DEV_CAPACITY,
  type HealthMilestoneRow,
  type HealthResult,
} from '../lib/webProjectHealth'
import { computeDevQueue, type QueueSlot } from '../lib/webDevQueue'
import {
  classifyTaskByPhase,
  inferProgressFromTasks,
  inferredDevRemainingHours,
  type ClickUpTaskRow,
  type PhaseInference,
} from '../lib/webPhaseInference'
import type {
  StrategyWebProject,
  StrategyDevWeeklyAllocation,
  PhaseProgress,
} from '../types/database'

/** Dev-classified ClickUp task for the schedule view. Carries
 *  enough metadata to place it on a calendar (due_date_after) and
 *  link out to ClickUp (task_id). status drives the chip color. */
export interface DevTaskRow {
  task_id:                 string
  task_name:               string
  current_status:          string | null
  time_estimate_minutes:   number | null
  due_date_after:          string | null    // ISO yyyy-mm-dd
  /** Synthesized — true when current_status normalizes to complete. */
  isComplete:              boolean
  /** Synthesized — true when status is in the engaged set
   *  (in progress / ready to start / sqd review / etc.). */
  isEngaged:               boolean
}

export interface ProjectRowVM extends StrategyWebProject {
  church_name:           string | null
  latest_milestone_at:   string | null      // most recent submitted_at
  milestones:            HealthMilestoneRow[]
  allocations:           StrategyDevWeeklyAllocation[]
  health:                HealthResult
  queueSlot:             QueueSlot | null
  /** ClickUp task inference for this project's Website list. Null
   *  when no matching folder/list exists in ClickUp. */
  inference:             PhaseInference | null
  /** Dev-classified ClickUp tasks for this project. Rendered as
   *  chips in the Schedule view; ordered by due_date_after asc
   *  (nulls last). Empty when no ClickUp folder is matched. */
  devTasks:              DevTaskRow[]
}

const COMPLETE = new Set(['complete', 'closed', 'done'])
const ENGAGED = new Set([
  'complete', 'closed', 'done',
  'in progress', 'received', 'ready to start',
  'sqd review', 'needs an update', 'waiting feedback',
  'dependent', 'in_revision', 'more info need',
])

interface UseProjectsWithHealthResult {
  rows:    ProjectRowVM[]
  loading: boolean
  error:   string | null
  refetch: () => Promise<void>
}

const REFRESH_INTERVAL_MS = 60_000

export function useProjectsWithHealth(options?: {
  includeArchived?: boolean
}): UseProjectsWithHealthResult {
  const includeArchived = options?.includeArchived ?? false
  const [rows, setRows] = useState<ProjectRowVM[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    setError(null)
    try {
      // Projects + church names (existing pattern in WebProjectsPage).
      let projectQuery = supabase
        .from('strategy_web_projects')
        .select('*')
        .order('priority_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (!includeArchived) projectQuery = projectQuery.eq('archived', false)
      const { data: projects, error: projErr } = await projectQuery
      if (projErr) throw new Error(projErr.message)
      const projectRows = (projects ?? []) as StrategyWebProject[]

      if (projectRows.length === 0) {
        if (mountedRef.current) {
          setRows([])
          setLoading(false)
        }
        return
      }

      const memberIds  = [...new Set(projectRows.map(p => p.member))]
      const projectIds = projectRows.map(p => p.id)
      const today = new Date()
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

      const [
        { data: churches },
        { data: subs },
        { data: allocs },
        { data: folders },
      ] = await Promise.all([
        supabase
          .from('strategy_account_progress')
          .select('member, church_name')
          .in('member', memberIds),
        supabase
          .from('strategy_milestone_submissions')
          .select(`
            id, member, milestone_id, milestone_status, submitted_at,
            milestone:strategy_milestone_definitions ( squad, pathway, step_number )
          `)
          .in('member', memberIds)
          .eq('is_active', true)
          .order('submitted_at', { ascending: false }),
        supabase
          .from('strategy_dev_weekly_allocations')
          .select('*')
          .in('web_project_id', projectIds)
          .gte('week_starting', todayIso),
        // ClickUp folders for the Website space — match by member ID
        // prefix on the folder name ("1802 - Mosaic"). One query for
        // every project's folder beats N queries per row.
        supabase
          .from('clickup_folders')
          .select('id, name')
          .eq('space_id', 90171129510),
      ])

      const churchByMember = new Map<number, string | null>()
      for (const c of (churches ?? []) as Array<{ member: number; church_name: string | null }>) {
        churchByMember.set(c.member, c.church_name)
      }

      type EnrichedSubRow = HealthMilestoneRow & {
        member: number
        // Supabase returns either a single related row or an array
        // depending on the FK shape; we normalize below.
        milestone?: {
          squad?:       string | null
          pathway?:     string | null
          step_number?: number | null
        } | Array<{
          squad?:       string | null
          pathway?:     string | null
          step_number?: number | null
        }> | null
      }
      const subsByMember = new Map<number, HealthMilestoneRow[]>()
      const latestByMember = new Map<number, string>()
      for (const s of (subs ?? []) as EnrichedSubRow[]) {
        if (!subsByMember.has(s.member)) subsByMember.set(s.member, [])
        const def = Array.isArray(s.milestone) ? s.milestone[0] : s.milestone
        subsByMember.get(s.member)!.push({
          milestone_id:     s.milestone_id,
          milestone_status: s.milestone_status,
          submitted_at:     s.submitted_at,
          squad:            def?.squad       ?? null,
          pathway:          def?.pathway     ?? null,
          step_number:      def?.step_number ?? null,
        })
        if (!latestByMember.has(s.member)) latestByMember.set(s.member, s.submitted_at)
      }

      const allocsByProject = new Map<string, StrategyDevWeeklyAllocation[]>()
      for (const a of (allocs ?? []) as StrategyDevWeeklyAllocation[]) {
        if (!allocsByProject.has(a.web_project_id)) {
          allocsByProject.set(a.web_project_id, [])
        }
        allocsByProject.get(a.web_project_id)!.push(a)
      }

      // ── ClickUp inference per member ─────────────────────────
      // Resolve member → folder via name-prefix match, then folder →
      // Website list, then bulk-fetch task_details for every list.
      // Three queries cover all projects (vs N×3 per project).
      const folderByMember = new Map<number, number>()
      type FolderRow = { id: number; name: string }
      for (const f of ((folders ?? []) as FolderRow[])) {
        const m = /^(\d+)\s*-/.exec(f.name)
        const mid = m ? Number(m[1]) : NaN
        if (Number.isFinite(mid) && memberIds.includes(mid) && !folderByMember.has(mid)) {
          folderByMember.set(mid, f.id)
        }
      }
      const folderIds = Array.from(folderByMember.values())
      const inferenceByMember = new Map<number, PhaseInference>()
      const devTasksByMember  = new Map<number, DevTaskRow[]>()
      if (folderIds.length > 0) {
        const { data: lists } = await supabase
          .from('clickup_lists')
          .select('id, folder')
          .eq('space', 90171129510)
          .in('folder', folderIds)
          .ilike('name', '%website%')
        type ListRow = { id: number; folder: number }
        const listByFolder = new Map<number, number>()
        for (const l of ((lists ?? []) as ListRow[])) {
          if (!listByFolder.has(l.folder)) listByFolder.set(l.folder, l.id)
        }
        const listIds = Array.from(listByFolder.values())
        if (listIds.length > 0) {
          // Need due dates for the schedule view's task chips. Join
          // task_details with the latest-due-date view in JS — both
          // are filterable by task_id / list_id.
          const { data: tasks } = await supabase
            .from('task_details' as 'tasks')
            .select('task_id, task_name, current_status, time_estimate_minutes, task_archived, list_id')
            .in('list_id', listIds)
          type TaskRow = ClickUpTaskRow & { task_id: string; list_id: number }
          const tasksByList = new Map<number, TaskRow[]>()
          for (const t of ((tasks ?? []) as TaskRow[])) {
            if (!tasksByList.has(t.list_id)) tasksByList.set(t.list_id, [])
            tasksByList.get(t.list_id)!.push(t)
          }
          // Bulk-fetch due dates for every task we'll render.
          const allTaskIds = ((tasks ?? []) as TaskRow[]).map(t => t.task_id)
          const dueByTask = new Map<string, string | null>()
          if (allTaskIds.length > 0) {
            const { data: dues } = await supabase
              .from('view_latest_due_dates' as 'tasks')
              .select('task_id, due_date_after')
              .in('task_id', allTaskIds)
            for (const d of ((dues ?? []) as Array<{ task_id: string; due_date_after: string | null }>)) {
              dueByTask.set(d.task_id, d.due_date_after)
            }
          }
          for (const [member, folderId] of folderByMember) {
            const listId = listByFolder.get(folderId)
            if (!listId) continue
            const rows = tasksByList.get(listId) ?? []
            inferenceByMember.set(member, inferProgressFromTasks(rows))
            // Dev-only task subset for the schedule view chips.
            const devTasks: DevTaskRow[] = rows
              .filter(r => !r.task_archived && classifyTaskByPhase(r.task_name) === 'dev')
              .map(r => {
                const status = (r.current_status ?? '').toLowerCase().trim()
                return {
                  task_id:               r.task_id,
                  task_name:             r.task_name,
                  current_status:        r.current_status,
                  time_estimate_minutes: r.time_estimate_minutes,
                  due_date_after:        dueByTask.get(r.task_id) ?? null,
                  isComplete:            COMPLETE.has(status),
                  isEngaged:             ENGAGED.has(status),
                }
              })
              .sort((a, b) => {
                // Nulls last by due_date_after; complete tasks last among same date.
                if (a.due_date_after && b.due_date_after) {
                  return a.due_date_after.localeCompare(b.due_date_after)
                }
                if (a.due_date_after) return -1
                if (b.due_date_after) return 1
                return 0
              })
            devTasksByMember.set(member, devTasks)
          }
        }
      }

      // Build "effective" projects for the queue + health pass —
      // manual phase_progress always wins per phase, but when a
      // phase has no manual value we splice ClickUp's inferred
      // progress in. The dev-remaining hours flow through a
      // separate field (inferredDevRemainingHours) so the reason
      // text can distinguish "manual override" from "inferred from
      // ClickUp dev tasks" instead of conflating the two.
      type InferenceMeta = {
        project:                        StrategyWebProject
        inferredDevRemainingHours:      number | null
      }
      const projectsForMath: InferenceMeta[] = projectRows.map(p => {
        const inf = inferenceByMember.get(p.member) ?? null
        if (!inf) return { project: p, inferredDevRemainingHours: null }
        const mergedProgress: PhaseProgress = { ...(inf.perPhase ?? {}) }
        const storedProgress = (p.phase_progress ?? {}) as PhaseProgress
        for (const [k, v] of Object.entries(storedProgress)) {
          if (v != null) mergedProgress[k as keyof PhaseProgress] = v
        }
        return {
          project: { ...p, phase_progress: mergedProgress },
          inferredDevRemainingHours: inferredDevRemainingHours(
            inf,
            p.dev_hours_estimate ?? null,
          ),
        }
      })

      // Dev queue — feed the inferred dev hours into the slot's
      // own "remaining" field via a synthetic project shape that
      // preserves manual override priority.
      const queueInput = projectsForMath.map(({ project, inferredDevRemainingHours: inf }) =>
        inf != null && project.manual_remaining_hours == null
          ? { ...project, manual_remaining_hours: inf }
          : project,
      )
      const queue = computeDevQueue(queueInput, DEFAULT_DEV_CAPACITY, today)

      const built: ProjectRowVM[] = projectRows.map((p, idx) => {
        const milestones    = subsByMember.get(p.member) ?? []
        const allocations   = allocsByProject.get(p.id) ?? []
        const queueSlot     = queue.get(p.id) ?? null
        const { project: effective, inferredDevRemainingHours: infH } = projectsForMath[idx]
        const inferenceRow  = inferenceByMember.get(p.member) ?? null
        const health = computeProjectHealth({
          project: effective,
          milestones,
          allocations: allocations.map(a => ({
            week_starting: a.week_starting,
            hours: Number(a.hours),
          })),
          joshWeeklyCapacity: DEFAULT_DEV_CAPACITY,
          today,
          queueSlot: queueSlot ?? undefined,
          inferredDevRemainingHours: infH,
        })
        return {
          ...p,
          church_name: churchByMember.get(p.member) ?? null,
          latest_milestone_at: latestByMember.get(p.member) ?? null,
          milestones,
          allocations,
          health,
          queueSlot,
          inference: inferenceRow,
          devTasks: devTasksByMember.get(p.member) ?? [],
        }
      })

      if (mountedRef.current) {
        setRows(built)
        setLoading(false)
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to load projects')
        setLoading(false)
      }
    }
  }, [includeArchived])

  // Initial + interval refresh.
  useEffect(() => {
    mountedRef.current = true
    void load()
    const id = window.setInterval(() => { void load() }, REFRESH_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      window.clearInterval(id)
    }
  }, [load])

  return useMemo(
    () => ({ rows, loading, error, refetch: load }),
    [rows, loading, error, load],
  )
}
