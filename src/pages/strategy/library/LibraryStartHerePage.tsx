import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Check, ChevronDown, Globe, Plus, Search, Trash2, Users, User,
} from 'lucide-react'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, LibraryDrilldownHeader, DocTypeIcon, DeptPill,
} from '../../../components/library/LibraryShell'
import { StrategyLoadingCard } from '../../../components/strategy/StrategyUI'
import {
  employeeDepartmentToStrategy, listSquadStaff, listStaffEmployees,
} from '../../../lib/library'
import type { OnboardingAssignment } from '../../../lib/library'
import type { Department, DocHubEntry, EmployeeRef } from '../../../types/strategy'
import { AddDocModal } from './AddDocModal'

const DEPT_LABEL: Record<Department, string> = {
  'all-in': 'All In', web: 'Web', branding: 'Branding', social: 'Social',
}

/** Start Here — onboarding checklist of priority + team-onboarding-tagged
 *  docs, plus per-user/per-dept/global assignments from the Director Tools
 *  panel. Progress bar + checkable rows. */
export default function LibraryStartHerePage() {
  const {
    loading, docs, myReads, me, onboardingAssignments,
  } = useLibraryData()

  /** Build the user's Start Here list. Three sources are unioned:
   *   1. Legacy: priorityDoc + workflowSteps starts with 'Internal: Team Onboarding'
   *   2. Global assignments (set by VP — required for any new hire)
   *   3. Department assignments matching `me.department`
   *   4. User assignments matching `me.employeeId`
   *  All four collapse into one deduplicated list, dept-gated for non-VP
   *  viewers. */
  const onboardingDocs = useMemo(() => {
    const includedIds = new Set<string>()
    const include = (id: string) => includedIds.add(id)

    for (const d of docs) {
      if (
        d.priorityDoc &&
        d.workflowSteps.some(s => s.startsWith('Internal: Team Onboarding'))
      ) include(d.id)
    }
    for (const a of onboardingAssignments) {
      if (a.scope === 'global') include(a.docNotionId)
      else if (a.scope === 'department' && a.department === me.department) include(a.docNotionId)
      else if (a.scope === 'user' && me.employeeId && a.employeeId === me.employeeId) include(a.docNotionId)
    }

    return docs
      .filter(d => includedIds.has(d.id))
      .filter(d => {
        if (me.isVP) return true
        if (d.department === 'all-in') return true
        return me.department ? d.department === me.department : true
      })
  }, [docs, onboardingAssignments, me.isVP, me.department, me.employeeId])

  const readCount = onboardingDocs.filter(d => myReads.has(d.id)).length
  const pct = onboardingDocs.length ? Math.round((readCount / onboardingDocs.length) * 100) : 0

  return (
    <>
      <LibraryNavBar
        crumbs={[
          { label: 'Library', to: '/strategy/library' },
          { label: 'Start Here' },
        ]}
      />
      <LibraryDrilldownHeader title="Start Here" />

      {loading && onboardingDocs.length === 0 && <StrategyLoadingCard label="Loading…" />}

      {(me.isDirector || me.isVP) && (
        <div className="rounded-md border border-[#D8CCF4] bg-white px-4 py-3 mb-5 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-[var(--color-lib-text)]">
            <strong>Director?</strong> Manage onboarding docs and per-person assignments in the Doc Manager.
          </span>
          <Link
            to="/strategy/library/manager?tab=onboarding"
            className="ml-auto inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-accent)] text-[var(--color-lib-accent)] bg-white text-xs font-medium px-2.5 py-1.5 hover:bg-[var(--color-lib-accent-soft)]"
          >
            Open Doc Manager
            <ChevronDown size={11} className="-rotate-90" />
          </Link>
        </div>
      )}

      <div className="rounded-lg border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] p-5 mb-5">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--color-lib-accent)] mb-2">
          {me.name ? `Welcome, ${me.name} 👋` : 'Onboarding reading list'}
        </h2>
        <p className="text-sm text-[var(--color-lib-text)] leading-relaxed">
          {me.name
            ? `Priority docs for getting oriented. Work through these at your pace — check each off as you read it.`
            : 'Priority docs for new hires. Browse them below.'}
        </p>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex-1 h-1.5 rounded-full bg-white overflow-hidden max-w-xs">
            <div
              className="h-full rounded-full bg-[var(--color-lib-accent)]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-sm font-semibold text-[var(--color-lib-accent)] whitespace-nowrap">
            {readCount} of {onboardingDocs.length} complete · {pct}%
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {onboardingDocs.map(d => (
          <OnboardingItem
            key={d.id}
            doc={d}
            read={myReads.has(d.id)}
          />
        ))}
      </div>

      {!loading && onboardingDocs.length === 0 && (
        <p className="text-sm text-[var(--color-lib-text-subtle)] italic">
          No onboarding docs assigned to you yet.{' '}
          {(me.isDirector || me.isVP)
            ? 'Use the Director Tools panel above to add docs to your dept or specific staff.'
            : 'Ask your director to assign reading via the Library.'}
        </p>
      )}
    </>
  )
}

function OnboardingItem({ doc, read }: { doc: DocHubEntry; read: boolean }) {
  const locked = doc.verificationStatus !== 'verified'
  const className = [
    'grid grid-cols-[24px_1fr_auto] gap-3 items-center rounded-md border bg-[var(--color-lib-surface)] px-4 py-3',
    'border-[var(--color-lib-border)]',
    locked ? 'opacity-65 cursor-not-allowed bg-[var(--color-lib-bg)]' : 'hover:border-[var(--color-lib-border-strong)]',
    read ? 'opacity-60' : '',
  ].join(' ')

  const inner = (
    <>
      <div
        className={`w-5 h-5 rounded-full grid place-items-center border-2 shrink-0 ${
          read
            ? 'bg-[var(--color-status-launched)] border-[var(--color-status-launched)] text-white'
            : locked
              ? 'border-dashed border-[var(--color-lib-border)]'
              : 'border-[var(--color-lib-border-strong)]'
        }`}
      >
        {read && <Check size={12} strokeWidth={3} />}
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-semibold text-[var(--color-lib-text)] ${read ? 'line-through' : ''}`}>
          <span className="inline-flex items-center gap-1.5">
            <DocTypeIcon type={doc.types[0]} size={13} />
            {doc.title}
          </span>
        </div>
        <div className="flex gap-2 items-center text-[11px] text-[var(--color-lib-text-muted)] mt-0.5">
          <DeptPill dept={doc.department} />
          {doc.types[0] && <span>{doc.types[0]}</span>}
          {locked && <span className="text-[var(--color-priority-medium)]">⏱ Pending verification — hold off until approved</span>}
        </div>
      </div>
      <span className="text-[11px] text-[var(--color-lib-text-subtle)] whitespace-nowrap">
        {read ? 'Read' : locked ? 'Locked' : 'Unread'}
      </span>
    </>
  )

  if (locked) return <div className={className}>{inner}</div>
  return (
    <Link to={`/strategy/library/doc/${doc.id}`} className={className}>
      {inner}
    </Link>
  )
}

// ── Director Tools panel ─────────────────────────────────────────────────
//
// Lives on the Doc Manager Onboarding tab. Department-wide only — per-
// person assignments live in Manage Squad (one path, no duplication).
// `AddExistingDocSection` still supports the `user` scope internally for
// callers that need it, but this surface only exposes Global +
// Department scopes.

export function OnboardingDirectorTools() {
  const { me } = useLibraryData()
  const [creatingDoc, setCreatingDoc] = useState(false)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-base font-semibold text-[var(--color-lib-text)] mb-1">
          Department-level Onboarding Docs
        </p>
        <p className="text-[11px] text-[var(--color-lib-text-muted)]">
          {me.isVP
            ? 'Manage onboarding documents that every new hire sees — set globally across the org, or per-department. To assign for a specific person, head to Manage Squad and click into them.'
            : `Manage onboarding documents that are universal for anyone in the ${me.department ? DEPT_LABEL[me.department] : 'your'} squad. To assign for a specific person, head to Manage Squad and click into them.`}
        </p>
      </div>

      <AddExistingDocSection />
      <div className="border-t border-dashed border-[var(--color-lib-border)] pt-3">
        <button
          type="button"
          onClick={() => setCreatingDoc(true)}
          className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-lib-accent)] text-[var(--color-lib-accent)] bg-white text-xs font-medium px-2.5 py-1.5 hover:bg-[var(--color-lib-accent-soft)]"
        >
          <Plus size={12} />
          Create a new onboarding doc
        </button>
        <p className="text-[11px] text-[var(--color-lib-text-muted)] mt-1">
          Opens the New Doc form with <em>Priority</em> and <em>Internal: Team Onboarding</em> pre-set.
        </p>
      </div>
      <ManageAssignmentsSection />

      {creatingDoc && (
        <AddDocModal
          mode="onboarding"
          presetDept={me.isVP ? null : me.department}
          onClose={() => setCreatingDoc(false)}
        />
      )}
    </div>
  )
}

// ── Per-Person view ──────────────────────────────────────────────────────
//
// Pick an employee → see their full Start Here set (legacy + global + dept
// + per-user assignments) → quick-add docs scoped to just that person.
// Designed for the case where a director is onboarding a specific new hire
// and wants to curate their reading list in one place.

function PerPersonView() {
  const { me, docs, onboardingAssignments, addAssignment, removeAssignment } = useLibraryData()
  const [employees, setEmployees] = useState<EmployeeRef[]>([])
  const [pickedEmployeeId, setPickedEmployeeId] = useState('')
  const [docSearch, setDocSearch] = useState('')
  const [pickedDoc, setPickedDoc] = useState<DocHubEntry | null>(null)
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Track scope for each row so we can show a context-aware confirm
   *  message when removing — global removes affect everyone. */

  useEffect(() => {
    let cancelled = false
    // Dept-gated: non-VP directors see their squad only.
    const loader = me.isVP || !me.department
      ? listStaffEmployees()
      : listSquadStaff(me.department)
    loader
      .then(list => { if (!cancelled) setEmployees(list) })
      .catch(() => {/* silent */})
    return () => { cancelled = true }
  }, [me.isVP, me.department])

  const employee = useMemo(
    () => employees.find(e => e.id === pickedEmployeeId) ?? null,
    [employees, pickedEmployeeId],
  )
  const employeeStrategyDept = useMemo(
    () => employee ? employeeDepartmentToStrategy(employee.department) : null,
    [employee],
  )

  /** Build the employee's complete Start Here set. Each row carries the
   *  list of *all* assignments behind it so a director can pick which one
   *  to remove (e.g., a doc could be both Global AND For this person —
   *  removing the per-person assignment leaves the global in place). */
  type PersonRow = {
    doc: DocHubEntry
    /** All assignment rows that contributed to this doc being on the
     *  list. May be empty (onboarding-flag-only). */
    assignments: Array<{ id: string; scope: OnboardingAssignment['scope']; label: string }>
    /** Whether the doc is on the list because of `priorityDoc + workflow
     *  step` (intrinsic, no assignment row). */
    fromOnboardingFlag: boolean
  }
  const personDocs = useMemo<PersonRow[]>(() => {
    if (!employee) return []
    const m = new Map<string, PersonRow>()
    const ensure = (id: string): PersonRow => {
      const found = m.get(id)
      if (found) return found
      const doc = docs.find(d => d.id === id)
      if (!doc) return { doc: null as unknown as DocHubEntry, assignments: [], fromOnboardingFlag: false }
      const row: PersonRow = { doc, assignments: [], fromOnboardingFlag: false }
      m.set(id, row)
      return row
    }
    for (const d of docs) {
      if (
        d.priorityDoc &&
        d.workflowSteps.some(s => s.startsWith('Internal: Team Onboarding'))
      ) {
        const row = ensure(d.id)
        row.fromOnboardingFlag = true
      }
    }
    for (const a of onboardingAssignments) {
      if (a.scope === 'global') {
        const row = ensure(a.docNotionId)
        row.assignments.push({ id: a.id, scope: 'global', label: 'Global' })
      } else if (a.scope === 'department' && a.department === employeeStrategyDept) {
        const row = ensure(a.docNotionId)
        row.assignments.push({ id: a.id, scope: 'department', label: `${DEPT_LABEL[a.department]} dept` })
      } else if (a.scope === 'user' && a.employeeId === employee.id) {
        const row = ensure(a.docNotionId)
        row.assignments.push({ id: a.id, scope: 'user', label: 'For this person' })
      }
    }
    return [...m.values()]
      .filter(r => !!r.doc)
      .sort((a, b) => a.doc.title.localeCompare(b.doc.title))
  }, [employee, employeeStrategyDept, docs, onboardingAssignments])

  const docMatches = useMemo(() => {
    const q = docSearch.trim().toLowerCase()
    if (!q || !employee) return [] as DocHubEntry[]
    const alreadyById = new Set(personDocs.map(p => p.doc.id))
    return docs
      .filter(d => !alreadyById.has(d.id) && d.title.toLowerCase().includes(q))
      .slice(0, 8)
  }, [docs, docSearch, personDocs, employee])

  const handleAddForPerson = async () => {
    if (!pickedDoc || !employee || !me.employeeId) return
    setAdding(true)
    setError(null)
    try {
      await addAssignment({
        docNotionId: pickedDoc.id,
        scope: 'user',
        employeeId: employee.id,
        callerEmployeeId: me.employeeId,
      })
      setPickedDoc(null)
      setDocSearch('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  const handleRemoveAssignment = async (assignmentId: string, scope: OnboardingAssignment['scope']) => {
    const scopeMessage =
      scope === 'global' ? 'Removing this Global assignment removes it for every new hire across the org.'
      : scope === 'department' ? 'Removing this Department assignment removes it for everyone in that dept.'
      : "Removing this assignment removes it from this person's list."
    if (!confirm(`${scopeMessage}\n\nProceed?`)) return
    setRemovingId(assignmentId)
    setError(null)
    try {
      await removeAssignment(assignmentId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-1">
          Person
        </label>
        <select
          value={pickedEmployeeId}
          onChange={e => setPickedEmployeeId(e.target.value)}
          className="w-full rounded-sm border border-[var(--color-lib-border)] bg-white text-sm px-2 py-2 outline-none"
        >
          <option value="">{employees.length === 0 ? 'Loading staff…' : 'Select a staff member…'}</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>
              {e.fullName}{e.role ? ` · ${e.role}` : ''}{e.department ? ` (${e.department})` : ''}
            </option>
          ))}
        </select>
      </div>

      {employee && (
        <>
          <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] p-3">
            <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-2">
              {employee.fullName}'s onboarding ({personDocs.length})
            </p>
            {personDocs.length === 0 ? (
              <p className="text-xs text-[var(--color-lib-text-muted)] italic">
                Nothing assigned yet. Search a doc below to add their first one.
              </p>
            ) : (
              <div className="space-y-1.5">
                {personDocs.map(({ doc, assignments, fromOnboardingFlag }) => (
                  <div
                    key={doc.id}
                    className="rounded-sm bg-white border border-[var(--color-lib-border)] px-2 py-1.5 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <DocTypeIcon type={doc.types[0]} size={12} />
                      <Link
                        to={`/strategy/library/doc/${doc.id}`}
                        className="flex-1 min-w-0 text-xs text-[var(--color-lib-text)] truncate hover:text-[var(--color-lib-accent)] hover:underline"
                      >
                        {doc.title}
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-1 ml-5">
                      {fromOnboardingFlag && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 bg-[var(--color-lib-bg)] border border-[var(--color-lib-border)] text-[var(--color-lib-text-subtle)]"
                          title="Doc has Priority + Internal: Team Onboarding flags. Edit in Notion (or via the doc edit pencil) to remove from the global onboarding flow."
                        >
                          <span className="text-[8px]">●</span>
                          Onboarding-flagged
                        </span>
                      )}
                      {assignments.map(a => (
                        <span
                          key={a.id}
                          className={[
                            'inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 border',
                            a.scope === 'global'     ? 'bg-[var(--color-lib-accent-soft)] border-[#D8CCF4] text-[var(--color-lib-accent)]'
                            : a.scope === 'department' ? 'bg-[#FEF3C7] border-[#F59E0B]/40 text-[var(--color-priority-medium)]'
                            : 'bg-white border-[var(--color-lib-border)] text-[var(--color-lib-text-muted)]',
                          ].join(' ')}
                        >
                          {a.label}
                          <button
                            type="button"
                            onClick={() => handleRemoveAssignment(a.id, a.scope)}
                            disabled={removingId === a.id}
                            title={`Remove ${a.label}`}
                            className="hover:text-red-500 disabled:opacity-50 ml-0.5 -mr-0.5"
                          >
                            <Trash2 size={9} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-dashed border-[var(--color-lib-border)] pt-3">
            <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-2">
              Add an onboarding doc just for {employee.fullName}
            </p>
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-lib-text-subtle)]"
              />
              <input
                value={pickedDoc ? pickedDoc.title : docSearch}
                onChange={e => { setDocSearch(e.target.value); setPickedDoc(null) }}
                placeholder="Search doc title…"
                disabled={adding}
                className="w-full pl-8 pr-3 py-2 rounded-sm border border-[var(--color-lib-border)] bg-white text-sm outline-none focus:border-[var(--color-lib-accent)]"
              />
            </div>
            {!pickedDoc && docMatches.length > 0 && (
              <div className="mt-1 rounded-sm border border-[var(--color-lib-border)] bg-white max-h-56 overflow-y-auto">
                {docMatches.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => { setPickedDoc(d); setDocSearch('') }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--color-lib-bg)] border-b border-[var(--color-lib-border)] last:border-b-0"
                  >
                    <DocTypeIcon type={d.types[0]} size={11} />
                    <span className="flex-1 truncate text-[var(--color-lib-text)]">{d.title}</span>
                    <DeptPill dept={d.department} />
                  </button>
                ))}
              </div>
            )}
            {pickedDoc && (
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setPickedDoc(null); setDocSearch('') }}
                  disabled={adding}
                  className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2.5 py-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddForPerson}
                  disabled={adding}
                  className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-lib-accent)] text-white text-xs font-medium px-2.5 py-1 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
                >
                  {adding ? 'Adding…' : `Assign to ${employee.fullName.split(' ')[0]}`}
                </button>
              </div>
            )}
            {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
          </div>
        </>
      )}
    </div>
  )
}

/** Search doc hub → pick a doc → choose scope (global/dept/user) → save. */
function AddExistingDocSection() {
  const { me, docs, addAssignment, onboardingAssignments } = useLibraryData()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<DocHubEntry | null>(null)
  const [scope, setScope] = useState<'global' | 'department' | 'user'>(me.isVP ? 'global' : 'department')
  const [pickedDept, setPickedDept] = useState<Department>(me.department ?? 'web')
  const [pickedEmployee, setPickedEmployee] = useState<string>('')
  const [employees, setEmployees] = useState<EmployeeRef[]>([])
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load staff lazily when the user selects 'user' scope.
  // Director scope is dept-gated: non-VP directors only see staff in
  // their own dept (matches the "manage onboarding for your squad"
  // framing). VP sees the full active roster.
  useEffect(() => {
    if (scope !== 'user' || employees.length > 0) return
    let cancelled = false
    setLoadingEmployees(true)
    const loader = me.isVP || !me.department
      ? listStaffEmployees()
      : listSquadStaff(me.department)
    loader
      .then(list => { if (!cancelled) setEmployees(list) })
      .catch(() => {/* silent — picker just shows empty */})
      .finally(() => { if (!cancelled) setLoadingEmployees(false) })
    return () => { cancelled = true }
  }, [scope, employees.length, me.isVP, me.department])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [] as DocHubEntry[]
    return docs
      .filter(d => d.title.toLowerCase().includes(q))
      .slice(0, 8)
  }, [docs, query])

  // Hide already-assigned-at-this-scope docs in the search results.
  const alreadyAssigned = useMemo(() => {
    return new Set(onboardingAssignments
      .filter(a => {
        if (a.scope !== scope) return false
        if (scope === 'department') return a.department === pickedDept
        if (scope === 'user') return a.employeeId === pickedEmployee
        return true
      })
      .map(a => a.docNotionId))
  }, [onboardingAssignments, scope, pickedDept, pickedEmployee])

  const canSave =
    !!picked &&
    !!me.employeeId &&
    !alreadyAssigned.has(picked.id) &&
    (scope === 'global' || (scope === 'department' && !!pickedDept) || (scope === 'user' && !!pickedEmployee))

  const handleSave = async () => {
    if (!picked || !me.employeeId) return
    setSaving(true)
    setError(null)
    try {
      await addAssignment({
        docNotionId: picked.id,
        scope,
        department: scope === 'department' ? pickedDept : null,
        employeeId: scope === 'user' ? pickedEmployee : null,
        callerEmployeeId: me.employeeId,
      })
      setQuery('')
      setPicked(null)
      setPickedEmployee('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-2">
        Add an existing doc to onboarding
      </p>
      <div className="relative">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-lib-text-subtle)]"
        />
        <input
          value={picked ? picked.title : query}
          onChange={e => { setQuery(e.target.value); setPicked(null) }}
          placeholder="Search doc title…"
          disabled={saving}
          className="w-full pl-8 pr-3 py-2 rounded-sm border border-[var(--color-lib-border)] bg-white text-sm outline-none focus:border-[var(--color-lib-accent)]"
        />
      </div>
      {!picked && matches.length > 0 && (
        <div className="mt-1 rounded-sm border border-[var(--color-lib-border)] bg-white max-h-56 overflow-y-auto">
          {matches.map(d => (
            <button
              key={d.id}
              type="button"
              onClick={() => { setPicked(d); setQuery('') }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--color-lib-bg)] border-b border-[var(--color-lib-border)] last:border-b-0"
            >
              <DocTypeIcon type={d.types[0]} size={11} />
              <span className="flex-1 truncate text-[var(--color-lib-text)]">{d.title}</span>
              <DeptPill dept={d.department} />
            </button>
          ))}
        </div>
      )}
      {picked && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 items-end">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-1">
              Scope
            </label>
            <select
              value={scope}
              onChange={e => setScope(e.target.value as 'global' | 'department' | 'user')}
              disabled={saving}
              className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1.5"
            >
              {me.isVP && <option value="global">Global · everyone</option>}
              <option value="department">Department</option>
              {/* Per-person scope intentionally absent — Manage Squad
                  owns that flow. One path, no duplication. */}
            </select>
          </div>
          {scope === 'department' && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-1">
                Department
              </label>
              <select
                value={pickedDept}
                onChange={e => setPickedDept(e.target.value as Department)}
                disabled={saving || (!me.isVP)}
                className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1.5 w-full"
              >
                {me.isVP && <option value="all-in">All In</option>}
                <option value="web">Web</option>
                <option value="branding">Branding</option>
                <option value="social">Social</option>
              </select>
            </div>
          )}
          {scope === 'user' && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-1">
                Person
              </label>
              <select
                value={pickedEmployee}
                onChange={e => setPickedEmployee(e.target.value)}
                disabled={saving || loadingEmployees}
                className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1.5 w-full"
              >
                <option value="">{loadingEmployees ? 'Loading…' : 'Select person…'}</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.fullName}{e.role ? ` — ${e.role}` : ''}</option>
                ))}
              </select>
            </div>
          )}
          {scope === 'global' && (
            <div className="text-xs text-[var(--color-lib-text-muted)] italic self-center">
              Required for every new hire across all squads.
            </div>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="rounded-sm bg-[var(--color-lib-accent)] text-white text-xs font-medium px-3 py-1.5 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? 'Adding…' : 'Add to onboarding'}
          </button>
        </div>
      )}
      {picked && alreadyAssigned.has(picked.id) && (
        <p className="text-[11px] text-[var(--color-priority-medium)] mt-1">
          This doc is already assigned at the chosen scope.
        </p>
      )}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}

/** List + remove current assignments. Filtered to scope visible to caller:
 *  VP sees everything, directors see global + their dept + every user
 *  assignment within their dept. */
function ManageAssignmentsSection() {
  const { me, docs, onboardingAssignments, removeAssignment } = useLibraryData()
  const [employeeNames, setEmployeeNames] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // Resolve employee_id → display name lazily. Only run if there are any
  // user-scoped rows visible to the caller.
  useEffect(() => {
    const userIds = onboardingAssignments
      .filter(a => a.scope === 'user' && a.employeeId)
      .map(a => a.employeeId!)
    if (userIds.length === 0) return
    let cancelled = false
    listStaffEmployees()
      .then(list => {
        if (cancelled) return
        const m = new Map<string, string>()
        for (const e of list) m.set(e.id, e.fullName ?? e.email ?? e.id)
        setEmployeeNames(m)
      })
      .catch(() => {/* silent */})
    return () => { cancelled = true }
  }, [onboardingAssignments])

  const visible = useMemo(() => {
    const docById = new Map(docs.map(d => [d.id, d]))
    return onboardingAssignments
      .filter(a => {
        if (me.isVP) return true
        if (a.scope === 'global') return true
        if (a.scope === 'department') return a.department === me.department
        if (a.scope === 'user') {
          // Director can see user assignments where the assigned employee
          // is in their dept. We don't have department-of-assignee on the
          // row; default to "show everything the director might've made".
          return true
        }
        return false
      })
      .map(a => ({ assignment: a, doc: docById.get(a.docNotionId) ?? null }))
  }, [onboardingAssignments, docs, me.isVP, me.department])

  if (visible.length === 0) {
    return (
      <div className="border-t border-dashed border-[var(--color-lib-border)] pt-3">
        <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-1">
          Current assignments
        </p>
        <p className="text-xs text-[var(--color-lib-text-muted)] italic">
          No onboarding assignments yet. Add some above.
        </p>
      </div>
    )
  }

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this onboarding assignment? Staff will no longer see it on their onboarding list.')) return
    setRemovingId(id)
    setError(null)
    try {
      await removeAssignment(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="border-t border-dashed border-[var(--color-lib-border)] pt-3">
      <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-2">
        Current assignments ({visible.length})
      </p>
      <div className="space-y-1">
        {visible.map(({ assignment, doc }) => (
          <div
            key={assignment.id}
            className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-sm border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)]"
          >
            <ScopeIcon scope={assignment.scope} />
            <span className="flex-1 min-w-0">
              <span className="text-[var(--color-lib-text)] font-medium truncate">
                {doc ? doc.title : `(doc ${assignment.docNotionId.slice(0, 8)}…)`}
              </span>
              <span className="text-[var(--color-lib-text-subtle)] ml-2">
                {scopeLabel(assignment, employeeNames)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => handleRemove(assignment.id)}
              disabled={removingId === assignment.id}
              title="Remove"
              className="text-[var(--color-lib-text-subtle)] hover:text-red-500 p-0.5 disabled:opacity-50"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}

function ScopeIcon({ scope }: { scope: OnboardingAssignment['scope'] }) {
  const Icon = scope === 'global' ? Globe : scope === 'department' ? Users : User
  const cls =
    scope === 'global' ? 'text-[var(--color-lib-accent)]'
    : scope === 'department' ? 'text-[var(--color-priority-medium)]'
    : 'text-[var(--color-lib-text-muted)]'
  return <Icon size={12} className={`shrink-0 ${cls}`} />
}

function scopeLabel(a: OnboardingAssignment, names: Map<string, string>): string {
  if (a.scope === 'global') return '· Global'
  if (a.scope === 'department') return `· ${a.department ? DEPT_LABEL[a.department] : 'Department'}`
  if (a.scope === 'user') {
    const name = a.employeeId ? names.get(a.employeeId) : null
    return `· ${name ?? 'User'}`
  }
  return ''
}

