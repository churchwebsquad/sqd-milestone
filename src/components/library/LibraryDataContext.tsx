/**
 * Library data context — single load of the shared state every Library
 * surface needs:
 *   - All Doc Hub entries (from Notion via the edge function)
 *   - Verifier defaults (from Supabase)
 *   - The signed-in user's read receipts (from Supabase)
 *   - All team read receipts (for the director/VP team-progress widget)
 *   - The signed-in employee record (resolved via AuthContext)
 *
 * The data is exposed alongside mutators that update local state
 * optimistically — Mark Read, Verify, Add Doc, etc. all flow through here
 * so every visible counter and badge stays in sync without re-fetching.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { listDocs } from '../../lib/strategyNotion'
import {
  addOnboardingAssignment, employeeDepartmentToStrategy,
  isDirectorByEmployeeId, isVPByEmail, listAllReads,
  listMyReads, listOnboardingAssignments, listRequiredReading,
  listVerifierDefaults, markDocAsRead, removeOnboardingAssignment,
  setDocRequired, unsetDocRequired,
} from '../../lib/library'
import type { AddAssignmentInput, OnboardingAssignment } from '../../lib/library'
import { isSetupError } from '../../lib/strategyNotion'
import type {
  Department, DocHubEntry, StrategyNotionSetupError, VerifierActive,
  VerifierDefault,
} from '../../types/strategy'
import { getActiveVerifier as resolveVerifier } from '../../lib/library'

interface LibraryData {
  loading: boolean
  setupError: StrategyNotionSetupError | null
  error: string | null

  /** Logged-in user's role context — derived once from staffProfile. */
  me: {
    employeeId: string | null
    name: string
    fullName: string
    email: string | null
    department: Department | null
    role: string | null
    avatarUrl: string | null
    isDirector: boolean
    isVP: boolean
  }

  /** All non-archived Doc Hub entries. */
  docs: DocHubEntry[]
  /** Doc IDs the signed-in user has marked read. */
  myReads: Set<string>
  /** Per-employee read sets, used by team-progress widgets. */
  teamReads: Map<string, Set<string>>
  /** Verifier defaults, indexed by dept. */
  defaults: VerifierDefault[]
  /** Convenience: resolve the active verifier for a dept. */
  activeVerifier: (dept: Department) => VerifierActive | null
  /** Onboarding assignments — combined with priorityDoc + workflow-step
   *  flag at read time to drive the Start Here flow. */
  onboardingAssignments: OnboardingAssignment[]
  /** Set of doc IDs flagged as required reading. */
  requiredReading: Set<string>

  /** Manual refresh — triggered by the Refresh button or window-focus.
   *  Soft-reload that doesn't blank the UI. */
  refresh: () => Promise<void>
  refreshing: boolean

  /** Mutators — they update local state on success so the UI doesn't wait
   *  for a refetch. */
  markRead: (docNotionId: string) => Promise<void>
  applyDocUpdate: (next: DocHubEntry) => void
  applyDocCreated: (next: DocHubEntry) => void
  applyDocArchived: (id: string) => void
  applyDefaultUpdate: (next: VerifierDefault) => void
  addAssignment: (input: AddAssignmentInput) => Promise<OnboardingAssignment>
  removeAssignment: (id: string) => Promise<void>
  setRequired: (docNotionId: string, required: boolean) => Promise<void>
}

const LibraryDataContext = createContext<LibraryData | null>(null)

export function LibraryDataProvider({ children }: { children: ReactNode }) {
  const { staffProfile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [setupError, setSetupError] = useState<StrategyNotionSetupError | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [docs, setDocs] = useState<DocHubEntry[]>([])
  const [myReads, setMyReads] = useState<Set<string>>(new Set())
  const [teamReads, setTeamReads] = useState<Map<string, Set<string>>>(new Map())
  const [defaults, setDefaults] = useState<VerifierDefault[]>([])
  const [onboardingAssignments, setOnboardingAssignments] = useState<OnboardingAssignment[]>([])
  const [requiredReading, setRequiredReading] = useState<Set<string>>(new Set())

  // `isDirector` derives from the verifier_defaults table (the source of
  // truth for who routes verification in each dept), so it depends on
  // `defaults` being loaded. `isVP` is a hardcoded email check that
  // doesn't wait. Treat `me` as initial-loading until defaults arrive.
  const me = useMemo(() => {
    const role = staffProfile?.role ?? null
    const fullName = staffProfile?.full_name ?? staffProfile?.name ?? ''
    const email = staffProfile?.email ?? null
    const isVP = isVPByEmail(email)
    return {
      employeeId: staffProfile?.id ?? null,
      name: fullName.split(' ')[0] || fullName,
      fullName,
      email,
      department: employeeDepartmentToStrategy(staffProfile?.department ?? null),
      role,
      avatarUrl: (staffProfile?.avatar_url as string | null | undefined) ?? null,
      isDirector: isVP || isDirectorByEmployeeId(staffProfile?.id ?? null, defaults),
      isVP,
    }
  }, [staffProfile, defaults])

  const reload = useCallback(async (isRefresh = false) => {
    if (!me.employeeId) return
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setSetupError(null)
    setError(null)
    try {
      // Always load team reads — `me.isDirector` derives from `defaults`,
      // which hasn't loaded yet on first call. Cheap query (Set of strings)
      // so we don't gate it on role and risk a bootstrapping miss.
      const [docsResult, defaultsResult, myReadsResult, teamReadsResult, assignmentsResult, requiredResult] = await Promise.allSettled([
        listDocs(),
        listVerifierDefaults(),
        listMyReads(me.employeeId),
        listAllReads(),
        listOnboardingAssignments(),
        listRequiredReading(),
      ])

      if (docsResult.status === 'fulfilled') {
        setDocs(docsResult.value)
      } else if (isSetupError(docsResult.reason)) {
        setSetupError(docsResult.reason)
      } else {
        setError(docsResult.reason instanceof Error ? docsResult.reason.message : String(docsResult.reason))
      }

      if (defaultsResult.status === 'fulfilled') setDefaults(defaultsResult.value)
      if (myReadsResult.status === 'fulfilled') setMyReads(myReadsResult.value)

      if (teamReadsResult.status === 'fulfilled') {
        const m = new Map<string, Set<string>>()
        const rows = teamReadsResult.value as Array<{ user_id: string; doc_notion_id: string }>
        for (const r of rows) {
          if (!m.has(r.user_id)) m.set(r.user_id, new Set())
          m.get(r.user_id)!.add(r.doc_notion_id)
        }
        setTeamReads(m)
      }
      if (assignmentsResult.status === 'fulfilled') setOnboardingAssignments(assignmentsResult.value)
      if (requiredResult.status === 'fulfilled') setRequiredReading(requiredResult.value)
    } finally {
      if (isRefresh) setRefreshing(false)
      else setLoading(false)
    }
  }, [me.employeeId])

  useEffect(() => { void reload(false) }, [reload])

  // Window-focus refresh — when the user comes back to the tab (or
  // switches windows back), pull fresh Notion data. Keeps Library in sync
  // with edits made directly in Notion without needing webhooks.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload(true)
    }
    window.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [reload])

  const refresh = useCallback(() => reload(true), [reload])

  const markRead = useCallback(async (docNotionId: string) => {
    if (!me.employeeId) return
    if (myReads.has(docNotionId)) return
    // Optimistic
    setMyReads(prev => {
      const next = new Set(prev)
      next.add(docNotionId)
      return next
    })
    try {
      await markDocAsRead(me.employeeId, docNotionId)
    } catch (err) {
      // Revert on failure
      setMyReads(prev => {
        const next = new Set(prev)
        next.delete(docNotionId)
        return next
      })
      throw err
    }
  }, [me.employeeId, myReads])

  const applyDocUpdate = useCallback((next: DocHubEntry) => {
    setDocs(prev => prev.map(d => d.id === next.id ? next : d))
  }, [])
  const applyDocCreated = useCallback((next: DocHubEntry) => {
    setDocs(prev => [next, ...prev])
  }, [])
  const applyDocArchived = useCallback((id: string) => {
    setDocs(prev => prev.filter(d => d.id !== id))
  }, [])
  const applyDefaultUpdate = useCallback((next: VerifierDefault) => {
    setDefaults(prev => prev.map(d => d.dept === next.dept ? next : d))
  }, [])

  const activeVerifier = useCallback(
    (dept: Department) => resolveVerifier(defaults, dept),
    [defaults],
  )

  const addAssignment = useCallback(async (input: AddAssignmentInput) => {
    const next = await addOnboardingAssignment(input)
    setOnboardingAssignments(prev => [next, ...prev])
    return next
  }, [])

  const removeAssignment = useCallback(async (id: string) => {
    setOnboardingAssignments(prev => prev.filter(a => a.id !== id))
    try {
      await removeOnboardingAssignment(id)
    } catch (err) {
      // Re-fetch to recover correct state on failure.
      try { setOnboardingAssignments(await listOnboardingAssignments()) } catch { /* ignore */ }
      throw err
    }
  }, [])

  const setRequired = useCallback(async (docNotionId: string, required: boolean) => {
    // Optimistic update
    setRequiredReading(prev => {
      const next = new Set(prev)
      if (required) next.add(docNotionId)
      else next.delete(docNotionId)
      return next
    })
    try {
      if (required) {
        if (!me.employeeId) throw new Error('Not signed in')
        await setDocRequired(docNotionId, me.employeeId)
      } else {
        await unsetDocRequired(docNotionId)
      }
    } catch (err) {
      // Revert
      setRequiredReading(prev => {
        const next = new Set(prev)
        if (required) next.delete(docNotionId)
        else next.add(docNotionId)
        return next
      })
      throw err
    }
  }, [me.employeeId])

  const value: LibraryData = {
    loading, refreshing, setupError, error, me,
    docs, myReads, teamReads, defaults, onboardingAssignments, requiredReading,
    activeVerifier,
    refresh,
    markRead, applyDocUpdate, applyDocCreated, applyDocArchived, applyDefaultUpdate,
    addAssignment, removeAssignment, setRequired,
  }

  return (
    <LibraryDataContext.Provider value={value}>
      {children}
    </LibraryDataContext.Provider>
  )
}

export function useLibraryData(): LibraryData {
  const ctx = useContext(LibraryDataContext)
  if (!ctx) throw new Error('useLibraryData must be used within LibraryDataProvider')
  return ctx
}
