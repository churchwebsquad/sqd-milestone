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
import type {
  StrategyWebProject,
  StrategyDevWeeklyAllocation,
} from '../types/database'

export interface ProjectRowVM extends StrategyWebProject {
  church_name:           string | null
  latest_milestone_at:   string | null      // most recent submitted_at
  milestones:            HealthMilestoneRow[]
  allocations:           StrategyDevWeeklyAllocation[]
  health:                HealthResult
  queueSlot:             QueueSlot | null
}

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

      // Dev queue — sequential capacity walk across all active
      // projects. Each row's slot becomes the authoritative source
      // for the launch projection (computeProjectHealth respects it
      // when supplied).
      const queue = computeDevQueue(projectRows, DEFAULT_DEV_CAPACITY, today)

      const built: ProjectRowVM[] = projectRows.map(p => {
        const milestones  = subsByMember.get(p.member) ?? []
        const allocations = allocsByProject.get(p.id) ?? []
        const queueSlot   = queue.get(p.id) ?? null
        const health = computeProjectHealth({
          project: p,
          milestones,
          allocations: allocations.map(a => ({
            week_starting: a.week_starting,
            hours: Number(a.hours),
          })),
          joshWeeklyCapacity: DEFAULT_DEV_CAPACITY,
          today,
          queueSlot: queueSlot ?? undefined,
        })
        return {
          ...p,
          church_name: churchByMember.get(p.member) ?? null,
          latest_milestone_at: latestByMember.get(p.member) ?? null,
          milestones,
          allocations,
          health,
          queueSlot,
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
