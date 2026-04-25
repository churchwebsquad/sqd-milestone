/**
 * Manage Squad — director / VP control surface for the squad's reading
 * stack. Designed as a single page-within-a-tab inside the Doc Manager
 * with three vertically stacked zones per department:
 *
 *   1. Onboarding Docs card — what every new hire in this dept reads
 *      first. Add or remove docs; the row of dept-member avatars at the
 *      top makes it obvious *who* the assignments apply to.
 *
 *   2. Reading List card — ongoing required reading for everyone in the
 *      dept. Each row carries doc metadata + a column of avatars showing
 *      who currently has it on their plate. Adding/removing a per-user
 *      assignment for a single doc happens via the avatar interactions
 *      (currently: per-person panel below).
 *
 *   3. Per-member cards (after a divider) — one card per active staff
 *      member in the squad with their read-progress percentages and the
 *      list of person-specific assignments. This is the place to make
 *      one-off adjustments to a single staff member's plate.
 *
 * VP scope: this whole layout repeats once per squad they oversee. Each
 * squad's data is independent.
 */

import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Star, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLibraryData } from './LibraryDataContext'
import {
  listSquadStaff, listStaffEmployees, strategyDepartmentsLed,
} from '../../lib/library'
import type { AddAssignmentInput, AssignmentKind, OnboardingAssignment } from '../../lib/library'
import { updateDoc } from '../../lib/strategyNotion'
import type { Department, DocHubEntry, EmployeeRef } from '../../types/strategy'
import { DocTypeIcon, VerifBadge, DeptPill } from './LibraryShell'

const DEPT_LABEL: Record<Department, string> = {
  web: 'Web', branding: 'Brand', social: 'Social', 'all-in': 'All In',
}

export function SquadProgress() {
  const {
    me, defaults, docs, teamReads, requiredReading, onboardingAssignments,
    addAssignment, removeAssignment, setRequired,
  } = useLibraryData()
  const [staffByDept, setStaffByDept] = useState<Map<Department, EmployeeRef[]>>(new Map())
  const [loading, setLoading] = useState(true)

  const ledDepts = useMemo(
    () => strategyDepartmentsLed(me.employeeId, defaults, me.isVP),
    [me.employeeId, me.isVP, defaults],
  )

  useEffect(() => {
    if (ledDepts.length === 0) {
      setStaffByDept(new Map())
      setLoading(false)
      return
    }
    setLoading(true)
    // 'all-in' has no per-squad employee mapping — fall back to the full
    // active staff roster so the section reads "applies to everyone".
    Promise.all(ledDepts.map(d => {
      const loader = d === 'all-in' ? listStaffEmployees() : listSquadStaff(d)
      return loader.then(s => [d, s] as const)
    }))
      .then(pairs => setStaffByDept(new Map(pairs)))
      .catch(() => setStaffByDept(new Map()))
      .finally(() => setLoading(false))
  }, [ledDepts])

  if (ledDepts.length === 0) return null

  return (
    <div className="space-y-8">
      {loading && <p className="text-xs text-[var(--color-lib-text-subtle)] italic">Loading squad…</p>}
      {ledDepts.map(dept => (
        <SquadSection
          key={dept}
          dept={dept}
          staff={staffByDept.get(dept) ?? []}
          docs={docs}
          teamReads={teamReads}
          requiredReading={requiredReading}
          onboardingAssignments={onboardingAssignments}
          addAssignment={addAssignment}
          removeAssignment={removeAssignment}
          setRequired={setRequired}
          callerEmployeeId={me.employeeId ?? ''}
          showDeptHeader={ledDepts.length > 1}
        />
      ))}
    </div>
  )
}

// ── Per-squad section ──────────────────────────────────────────────────

function SquadSection({
  dept, staff, docs, teamReads, requiredReading, onboardingAssignments,
  addAssignment, removeAssignment, setRequired,
  callerEmployeeId, showDeptHeader,
}: {
  dept: Department
  staff: EmployeeRef[]
  docs: DocHubEntry[]
  teamReads: Map<string, Set<string>>
  requiredReading: Set<string>
  onboardingAssignments: OnboardingAssignment[]
  addAssignment: (input: AddAssignmentInput) => Promise<OnboardingAssignment>
  removeAssignment: (id: string) => Promise<void>
  setRequired: (docNotionId: string, required: boolean) => Promise<void>
  callerEmployeeId: string
  showDeptHeader: boolean
}) {
  /** Onboarding doc set:
   *   - For dept-led sections: legacy (priority + Internal: Team
   *     Onboarding) limited to dept + global assignments + dept-scoped
   *     assignments.
   *   - For the All In section: every priority + Internal: Team
   *     Onboarding doc (regardless of dept) + every global-scoped
   *     assignment. Mirrors what new hires across the org actually see.
   *  Excludes per-user assignments — those live in the per-member
   *  cards below. */
  const isAllIn = dept === 'all-in'
  const onboardingDocs = useMemo(() => {
    const ids = new Set<string>()
    for (const d of docs) {
      if (d.priorityDoc && d.workflowSteps.includes('Internal: Team Onboarding')) {
        if (isAllIn || d.department === dept || d.department === 'all-in') ids.add(d.id)
      }
    }
    for (const a of onboardingAssignments) {
      if (a.kind !== 'onboarding') continue
      if (a.scope === 'global') ids.add(a.docNotionId)
      else if (!isAllIn && a.scope === 'department' && a.department === dept) ids.add(a.docNotionId)
    }
    return docs.filter(d => ids.has(d.id))
  }, [docs, onboardingAssignments, dept, isAllIn])

  /** Reading list:
   *   - Dept-led: Required-reading docs scoped to dept or all-in +
   *     dept-scoped reading-list assignments.
   *   - All In: every Required-reading doc + every global-scoped
   *     reading-list assignment. */
  const readingListDocs = useMemo(() => {
    const ids = new Set<string>()
    for (const d of docs) {
      if (requiredReading.has(d.id)) {
        if (isAllIn || d.department === dept || d.department === 'all-in') ids.add(d.id)
      }
    }
    for (const a of onboardingAssignments) {
      if (a.kind !== 'reading-list') continue
      if (a.scope === 'global' && isAllIn) ids.add(a.docNotionId)
      else if (!isAllIn && a.scope === 'department' && a.department === dept) ids.add(a.docNotionId)
    }
    return docs.filter(d => ids.has(d.id))
  }, [docs, onboardingAssignments, requiredReading, dept, isAllIn])

  return (
    <div className="space-y-4">
      {showDeptHeader && (
        <div className="flex items-center gap-2 pb-2 border-b border-[var(--color-lib-border)]">
          <DeptPill dept={dept} />
          <h2 className="text-base font-semibold text-[var(--color-lib-text)]">
            {dept === 'all-in' ? 'All In · Org-wide' : `${DEPT_LABEL[dept]} Squad`}
          </h2>
        </div>
      )}

      <OnboardingDocsCard
        dept={dept}
        docs={onboardingDocs}
        allDocs={docs}
        staff={staff}
        onboardingAssignments={onboardingAssignments}
        addAssignment={addAssignment}
        removeAssignment={removeAssignment}
        callerEmployeeId={callerEmployeeId}
      />

      <ReadingListCard
        dept={dept}
        docs={readingListDocs}
        allDocs={docs}
        staff={staff}
        onboardingAssignments={onboardingAssignments}
        addAssignment={addAssignment}
        removeAssignment={removeAssignment}
        setRequired={setRequired}
        callerEmployeeId={callerEmployeeId}
      />

      {/* Per-member cards aren't useful in the All In section — that
          surface is for org-wide configuration, not individual roll-ups
          (each person already has a card under their squad). Skip the
          divider + member grid for All In. */}
      {dept !== 'all-in' && (
        <>
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--color-lib-border)]" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-[var(--color-lib-bg)] px-3 text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)]">
                Squad members
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {staff.map(s => (
              <MemberCard
                key={s.id}
                member={s}
                allDocs={docs}
                requiredDocs={readingListDocs}
                onboardingDocs={onboardingDocs}
                readSet={teamReads.get(s.id) ?? new Set()}
                onboardingAssignments={onboardingAssignments}
                addAssignment={addAssignment}
                removeAssignment={removeAssignment}
                callerEmployeeId={callerEmployeeId}
              />
            ))}
            {staff.length === 0 && (
              <p className="text-xs text-[var(--color-lib-text-subtle)] italic col-span-full">
                No active staff in this squad yet.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Card 1: Onboarding Docs ──────────────────────────────────────────────

function OnboardingDocsCard({
  dept, docs, allDocs, staff, onboardingAssignments,
  addAssignment, removeAssignment, callerEmployeeId,
}: {
  dept: Department
  docs: DocHubEntry[]
  allDocs: DocHubEntry[]
  staff: EmployeeRef[]
  onboardingAssignments: OnboardingAssignment[]
  addAssignment: (input: AddAssignmentInput) => Promise<OnboardingAssignment>
  removeAssignment: (id: string) => Promise<void>
  callerEmployeeId: string
}) {
  const { applyDocUpdate } = useLibraryData()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isAllIn = dept === 'all-in'

  const handleAdd = async (docId: string) => {
    setBusyId(docId); setError(null)
    try {
      await addAssignment({
        docNotionId: docId,
        scope: isAllIn ? 'global' : 'department',
        kind: 'onboarding',
        department: isAllIn ? null : dept,
        callerEmployeeId,
      })
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusyId(null) }
  }

  const handleRemove = async (doc: DocHubEntry) => {
    setBusyId(doc.id); setError(null)
    try {
      const assn = onboardingAssignments.find(a => {
        if (a.kind !== 'onboarding') return false
        if (a.docNotionId !== doc.id) return false
        if (isAllIn) return a.scope === 'global'
        return a.scope === 'department' && a.department === dept
      })
      if (assn) {
        await removeAssignment(assn.id)
      } else {
        // Doc is on the list because the doc itself carries priorityDoc
        // + Internal: Team Onboarding tags. Removing here flips both
        // off so the doc no longer auto-appears for any department's
        // onboarding flow. We confirm first because this is a global
        // change (not just for the current dept).
        if (!confirm(`"${doc.title}" is on the onboarding flow because of its Priority + Internal: Team Onboarding tags on the doc itself. Removing here turns those off, which removes it from EVERY department's onboarding flow. Continue?`)) return
        const nextSteps = doc.workflowSteps.filter(s => s !== 'Internal: Team Onboarding')
        const next = await updateDoc(doc.id, {
          priorityDoc: false,
          workflowSteps: nextSteps,
        })
        applyDocUpdate(next)
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusyId(null) }
  }

  const heading = isAllIn ? 'All In Onboarding Docs' : `${DEPT_LABEL[dept]} Squad Onboarding Docs`
  const subhead = isAllIn
    ? 'Documents added here will appear on every new hire\'s onboarding workflow across all departments.'
    : 'Documents added here will appear on staff\'s onboarding workflow for your department.'

  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-lib-text)]">
            {heading}
          </h3>
          <p className="text-[11px] text-[var(--color-lib-text-muted)] leading-relaxed">
            {subhead}
          </p>
        </div>
      </div>

      {/* Dept-member avatar row — visual reminder of who these
          assignments apply to. */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mr-1">
          Applies to
        </span>
        {staff.length === 0 && (
          <span className="text-[11px] text-[var(--color-lib-text-subtle)] italic">No active staff yet</span>
        )}
        {staff.slice(0, 12).map(s => <Avatar key={s.id} member={s} />)}
        {staff.length > 12 && (
          <span className="text-[10px] text-[var(--color-lib-text-subtle)] ml-1">
            +{staff.length - 12} more
          </span>
        )}
      </div>

      {/* Doc list */}
      {docs.length === 0 ? (
        <p className="text-xs text-[var(--color-lib-text-subtle)] italic">
          No onboarding docs assigned yet for this squad. Search below to add one.
        </p>
      ) : (
        <div className="space-y-1 mb-3">
          {docs.map(doc => (
            <DocListRow
              key={doc.id}
              doc={doc}
              busy={busyId === doc.id}
              onRemove={() => handleRemove(doc)}
            />
          ))}
        </div>
      )}

      <DocSearchAdder
        excludeIds={new Set(docs.map(d => d.id))}
        allDocs={allDocs}
        placeholder="Search to add an onboarding doc…"
        onAdd={handleAdd}
        busyId={busyId}
      />
      {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}
    </div>
  )
}

// ── Card 2: Reading List ──────────────────────────────────────────────────

function ReadingListCard({
  dept, docs, allDocs, staff, onboardingAssignments,
  addAssignment, removeAssignment, setRequired, callerEmployeeId,
}: {
  dept: Department
  docs: DocHubEntry[]
  allDocs: DocHubEntry[]
  staff: EmployeeRef[]
  onboardingAssignments: OnboardingAssignment[]
  addAssignment: (input: AddAssignmentInput) => Promise<OnboardingAssignment>
  removeAssignment: (id: string) => Promise<void>
  setRequired: (docNotionId: string, required: boolean) => Promise<void>
  callerEmployeeId: string
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openOverrideDoc, setOpenOverrideDoc] = useState<DocHubEntry | null>(null)

  const isAllIn = dept === 'all-in'

  const handleAdd = async (docId: string) => {
    setBusyId(docId); setError(null)
    try {
      await addAssignment({
        docNotionId: docId,
        scope: isAllIn ? 'global' : 'department',
        kind: 'reading-list',
        department: isAllIn ? null : dept,
        callerEmployeeId,
      })
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusyId(null) }
  }

  const handleRemove = async (doc: DocHubEntry) => {
    setBusyId(doc.id); setError(null)
    try {
      const assn = onboardingAssignments.find(a => {
        if (a.kind !== 'reading-list') return false
        if (a.docNotionId !== doc.id) return false
        if (isAllIn) return a.scope === 'global'
        return a.scope === 'department' && a.department === dept
      })
      if (assn) {
        await removeAssignment(assn.id)
      } else {
        // Doc is on the list because Required-reading flag is on. Turn
        // it off globally (this is what the user expects when they
        // click remove from this surface).
        const scope = isAllIn ? 'across the org' : DEPT_LABEL[dept]
        if (!confirm(`"${doc.title}" is required reading globally — removing here turns the Required flag off for everyone, not just ${scope}. Continue?`)) return
        await setRequired(doc.id, false)
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusyId(null) }
  }

  const heading = isAllIn ? 'All In Reading List' : `${DEPT_LABEL[dept]} Squad Reading List`
  const subhead = isAllIn
    ? 'Documents added here will be shared as required reading to everyone across all departments.'
    : 'Documents added here will be shared as required reading to your department.'

  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-lib-text)]">
            {heading}
          </h3>
          <p className="text-[11px] text-[var(--color-lib-text-muted)] leading-relaxed">
            {subhead}
          </p>
        </div>
      </div>

      {/* Same applies-to row pattern as the Onboarding card — visual
          reminder that everyone in the dept is on these reading lists by
          default. Use the per-doc override to add cross-dept folks. */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mr-1">
          Applies to
        </span>
        {staff.length === 0 && (
          <span className="text-[11px] text-[var(--color-lib-text-subtle)] italic">No active staff yet</span>
        )}
        {staff.slice(0, 12).map(s => <Avatar key={s.id} member={s} />)}
        {staff.length > 12 && (
          <span className="text-[10px] text-[var(--color-lib-text-subtle)] ml-1">
            +{staff.length - 12} more
          </span>
        )}
      </div>

      {docs.length === 0 ? (
        <p className="text-xs text-[var(--color-lib-text-subtle)] italic mb-3">
          No reading-list docs for this squad yet. Search below to add one.
        </p>
      ) : (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-[var(--color-lib-text-subtle)] font-semibold">
              <tr>
                <th className="px-2 py-1.5 text-left">Doc</th>
                <th className="px-2 py-1.5 text-left">Group</th>
                <th className="px-2 py-1.5 text-left">Workflow Step</th>
                <th className="px-2 py-1.5 text-left">Verification</th>
                <th className="px-2 py-1.5 text-left w-32">Override</th>
                <th className="px-2 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => (
                <ReadingListRow
                  key={doc.id}
                  doc={doc}
                  busy={busyId === doc.id}
                  onRemove={() => handleRemove(doc)}
                  onOverride={() => setOpenOverrideDoc(doc)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DocSearchAdder
        excludeIds={new Set(docs.map(d => d.id))}
        allDocs={allDocs}
        placeholder="Search to add a doc to the reading list…"
        onAdd={handleAdd}
        busyId={busyId}
      />
      {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}

      {openOverrideDoc && (
        <PerDocOverrideModal
          doc={openOverrideDoc}
          dept={dept}
          staff={staff}
          onboardingAssignments={onboardingAssignments}
          addAssignment={addAssignment}
          removeAssignment={removeAssignment}
          callerEmployeeId={callerEmployeeId}
          onClose={() => setOpenOverrideDoc(null)}
        />
      )}
    </div>
  )
}

function ReadingListRow({ doc, busy, onRemove, onOverride }: {
  doc: DocHubEntry
  busy: boolean
  onRemove: () => void
  onOverride: () => void
}) {
  return (
    <tr className="border-t border-[var(--color-lib-border)] hover:bg-[var(--color-lib-bg)]">
      <td className="px-2 py-2 max-w-[260px]">
        <Link
          to={`/strategy/library/doc/${doc.id}`}
          className="flex items-center gap-1.5 min-w-0 hover:text-[var(--color-lib-accent)]"
        >
          <DocTypeIcon type={doc.types[0]} size={11} />
          <span className="truncate text-[var(--color-lib-text)] font-medium">{doc.title}</span>
        </Link>
      </td>
      <td className="px-2 py-2 truncate text-[var(--color-lib-text-muted)] max-w-[140px]">
        {doc.groups[0] ?? '—'}
      </td>
      <td className="px-2 py-2 truncate text-[var(--color-lib-text-muted)] max-w-[180px]">
        {doc.workflowSteps[0] ?? '—'}
      </td>
      <td className="px-2 py-2"><VerifBadge status={doc.verificationStatus} /></td>
      <td className="px-2 py-2">
        {/* Add cross-dept staff (e.g. a contractor) onto this single
            doc without changing the dept-wide rule. */}
        <button
          type="button"
          onClick={onOverride}
          className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white px-2 py-1 text-[10px] text-[var(--color-lib-text-muted)] hover:border-[var(--color-lib-accent)] hover:text-[var(--color-lib-accent)]"
          title="Add or remove additional individual staff for this doc"
        >
          <Plus size={9} />
          Override
        </button>
      </td>
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="text-[var(--color-lib-text-subtle)] hover:text-red-500 disabled:opacity-50"
          title="Remove from this dept's reading list"
        >
          <X size={11} />
        </button>
      </td>
    </tr>
  )
}

// ── Per-doc override modal ──────────────────────────────────────────────
//
// Click the avatar column on a reading-list row to open this modal.
// Lets directors add an explicit per-user reading-list assignment on
// this doc (e.g., "make sure Andrew also sees this even though he's
// in a different sub-track"). Removal of inherited dept-wide
// assignments isn't supported here — the row's X button does that.

function PerDocOverrideModal({
  doc, dept, staff, onboardingAssignments,
  addAssignment, removeAssignment, callerEmployeeId, onClose,
}: {
  doc: DocHubEntry
  dept: Department
  staff: EmployeeRef[]
  onboardingAssignments: OnboardingAssignment[]
  addAssignment: (input: AddAssignmentInput) => Promise<OnboardingAssignment>
  removeAssignment: (id: string) => Promise<void>
  callerEmployeeId: string
  onClose: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Per-user reading-list assignments on THIS doc. */
  const userAssignments = useMemo(
    () => onboardingAssignments.filter(a =>
      a.kind === 'reading-list' && a.scope === 'user' && a.docNotionId === doc.id,
    ),
    [onboardingAssignments, doc.id],
  )
  const explicitlyAssignedIds = new Set(userAssignments.map(a => a.employeeId).filter((x): x is string => !!x))

  const togglePerson = async (s: EmployeeRef) => {
    setBusyId(s.id); setError(null)
    try {
      const existing = userAssignments.find(a => a.employeeId === s.id)
      if (existing) {
        await removeAssignment(existing.id)
      } else {
        await addAssignment({
          docNotionId: doc.id,
          scope: 'user',
          kind: 'reading-list',
          employeeId: s.id,
          callerEmployeeId,
        })
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusyId(null) }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4 py-6" onClick={onClose}>
      <div
        className="bg-white rounded-xl max-w-md w-full shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--color-lib-border)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-0.5">
                Per-doc reading list — {DEPT_LABEL[dept]}
              </p>
              <h3 className="text-sm font-semibold text-[var(--color-lib-text)]">{doc.title}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)]"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-[11px] text-[var(--color-lib-text-muted)] mt-2 leading-relaxed">
            Toggle a person to add or remove their explicit reading-list assignment for this doc. The dept-wide rule still applies — this layer adds *additional* people (e.g., a contractor) on top of who's in the dept.
          </p>
        </div>
        <div className="px-5 py-3 max-h-72 overflow-y-auto space-y-1">
          {staff.map(s => {
            const explicit = explicitlyAssignedIds.has(s.id)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => togglePerson(s)}
                disabled={busyId === s.id}
                className={[
                  'w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                  explicit
                    ? 'bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)]'
                    : 'hover:bg-[var(--color-lib-bg)] text-[var(--color-lib-text)]',
                  busyId === s.id ? 'opacity-50' : '',
                ].join(' ')}
              >
                <Avatar member={s} read={explicit} />
                <span className="flex-1 text-left truncate">
                  {s.fullName ?? '(unnamed)'}
                </span>
                {explicit ? (
                  <span className="text-[10px] uppercase tracking-widest font-semibold">Assigned</span>
                ) : (
                  <span className="text-[10px] text-[var(--color-lib-text-subtle)]">Add</span>
                )}
              </button>
            )
          })}
        </div>
        {error && <p className="px-5 pb-3 text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  )
}

// ── Per-member card ──────────────────────────────────────────────────────

function MemberCard({
  member, allDocs, requiredDocs, onboardingDocs, readSet, onboardingAssignments,
  addAssignment, removeAssignment, callerEmployeeId,
}: {
  member: EmployeeRef
  allDocs: DocHubEntry[]
  requiredDocs: DocHubEntry[]
  onboardingDocs: DocHubEntry[]
  readSet: Set<string>
  onboardingAssignments: OnboardingAssignment[]
  addAssignment: (input: AddAssignmentInput) => Promise<OnboardingAssignment>
  removeAssignment: (id: string) => Promise<void>
  callerEmployeeId: string
}) {
  const [adding, setAdding] = useState<AssignmentKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Per-user assignments for this member (both kinds).
  const userOnboarding = useMemo(
    () => onboardingAssignments.filter(a =>
      a.scope === 'user' && a.employeeId === member.id && (a.kind ?? 'onboarding') === 'onboarding',
    ),
    [onboardingAssignments, member.id],
  )
  const userReadingList = useMemo(
    () => onboardingAssignments.filter(a =>
      a.scope === 'user' && a.employeeId === member.id && a.kind === 'reading-list',
    ),
    [onboardingAssignments, member.id],
  )

  // Read-progress percentages.
  const reqPct = requiredDocs.length
    ? Math.round((requiredDocs.filter(d => readSet.has(d.id)).length / requiredDocs.length) * 100)
    : null
  const onbPct = onboardingDocs.length
    ? Math.round((onboardingDocs.filter(d => readSet.has(d.id)).length / onboardingDocs.length) * 100)
    : null

  const handleAdd = async (docId: string, kind: AssignmentKind) => {
    setBusyId(docId); setError(null)
    try {
      await addAssignment({
        docNotionId: docId,
        scope: 'user',
        kind,
        employeeId: member.id,
        callerEmployeeId,
      })
      setAdding(null)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusyId(null) }
  }
  const handleRemove = async (id: string) => {
    setBusyId(id); setError(null)
    try { await removeAssignment(id) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusyId(null) }
  }

  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Avatar member={member} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--color-lib-text)] truncate">
            {member.fullName ?? '(unnamed)'}
          </p>
          <p className="text-[11px] text-[var(--color-lib-text-subtle)] truncate">
            {member.role && member.role !== 'employee' ? member.role : (member.department ?? '')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ProgressPill label="Required read" pct={reqPct} />
        <ProgressPill label="Onboarding read" pct={onbPct} />
      </div>

      {/* Person-specific Onboarding assignments */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)]">
            Person-specific onboarding ({userOnboarding.length})
          </p>
          <button
            type="button"
            onClick={() => setAdding(adding === 'onboarding' ? null : 'onboarding')}
            className="text-[10px] font-semibold text-[var(--color-lib-accent)] hover:underline"
          >
            {adding === 'onboarding' ? 'Cancel' : '+ Add'}
          </button>
        </div>
        {adding === 'onboarding' && (
          <DocSearchAdder
            excludeIds={new Set(userOnboarding.map(a => a.docNotionId))}
            allDocs={allDocs}
            placeholder={`Search to add onboarding doc for ${member.name}…`}
            onAdd={(docId) => handleAdd(docId, 'onboarding')}
            busyId={busyId}
            compact
          />
        )}
        {userOnboarding.length === 0 ? (
          <p className="text-[11px] text-[var(--color-lib-text-subtle)] italic">None — they get the dept's defaults.</p>
        ) : (
          <div className="space-y-1">
            {userOnboarding.map(a => (
              <UserAssignmentRow
                key={a.id}
                assignment={a}
                allDocs={allDocs}
                readSet={readSet}
                busy={busyId === a.id}
                onRemove={() => handleRemove(a.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Person-specific Reading list assignments */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)]">
            Person-specific reading list ({userReadingList.length})
          </p>
          <button
            type="button"
            onClick={() => setAdding(adding === 'reading-list' ? null : 'reading-list')}
            className="text-[10px] font-semibold text-[var(--color-lib-accent)] hover:underline"
          >
            {adding === 'reading-list' ? 'Cancel' : '+ Add'}
          </button>
        </div>
        {adding === 'reading-list' && (
          <DocSearchAdder
            excludeIds={new Set(userReadingList.map(a => a.docNotionId))}
            allDocs={allDocs}
            placeholder={`Search to add reading-list doc for ${member.name}…`}
            onAdd={(docId) => handleAdd(docId, 'reading-list')}
            busyId={busyId}
            compact
          />
        )}
        {userReadingList.length === 0 ? (
          <p className="text-[11px] text-[var(--color-lib-text-subtle)] italic">None — they get the dept's required reading.</p>
        ) : (
          <div className="space-y-1">
            {userReadingList.map(a => (
              <UserAssignmentRow
                key={a.id}
                assignment={a}
                allDocs={allDocs}
                readSet={readSet}
                busy={busyId === a.id}
                onRemove={() => handleRemove(a.id)}
              />
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

function UserAssignmentRow({ assignment, allDocs, readSet, busy, onRemove }: {
  assignment: OnboardingAssignment
  allDocs: DocHubEntry[]
  readSet: Set<string>
  busy: boolean
  onRemove: () => void
}) {
  const doc = allDocs.find(d => d.id === assignment.docNotionId)
  if (!doc) return null
  const read = readSet.has(doc.id)
  return (
    <div className="flex items-center gap-2 rounded-sm border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] px-2 py-1.5">
      <DocTypeIcon type={doc.types[0]} size={11} />
      <Link
        to={`/strategy/library/doc/${doc.id}`}
        className="flex-1 min-w-0 text-xs text-[var(--color-lib-text)] truncate hover:text-[var(--color-lib-accent)] hover:underline"
      >
        {doc.title}
      </Link>
      <span
        className={[
          'inline-flex items-center text-[10px] font-medium rounded-full px-1.5 py-px',
          read
            ? 'bg-[var(--color-verif-verified-bg)] text-[var(--color-verif-verified-fg)]'
            : 'bg-white border border-[var(--color-lib-border)] text-[var(--color-lib-text-subtle)]',
        ].join(' ')}
      >
        {read ? 'Read' : 'Unread'}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="text-[var(--color-lib-text-subtle)] hover:text-red-500 disabled:opacity-50"
        title="Remove"
      >
        <X size={11} />
      </button>
    </div>
  )
}

// ── Reusable bits ──────────────────────────────────────────────────────

/** Palette of background colors used to give each squad member a
 *  distinct, recognizable avatar. Rich enough to differentiate ~12 people
 *  per squad without the colors feeling too close. Hash the employee
 *  ID into the palette so the same person always gets the same color
 *  across renders + sessions. */
const AVATAR_PALETTE = [
  'bg-[#7C3AED]', // violet
  'bg-[#0EA5E9]', // sky
  'bg-[#10B981]', // emerald
  'bg-[#F59E0B]', // amber
  'bg-[#EC4899]', // pink
  'bg-[#EF4444]', // red
  'bg-[#6366F1]', // indigo
  'bg-[#14B8A6]', // teal
  'bg-[#F97316]', // orange
  'bg-[#8B5CF6]', // purple
  'bg-[#22C55E]', // green
  'bg-[#0891B2]', // cyan
] as const

function hashEmployeeColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
  const idx = Math.abs(h) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[idx]
}

function Avatar({ member, read = false, size = 'sm' }: {
  member: EmployeeRef
  /** Visual marker for "marked read". Adds a subtle ring around the avatar
   *  rather than overriding its color so the per-person identity stays
   *  recognizable. */
  read?: boolean
  size?: 'sm' | 'lg'
}) {
  const initials = (member.fullName ?? '??').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
  const dim = size === 'lg' ? 'w-9 h-9 text-[11px]' : 'w-6 h-6 text-[9px]'
  const color = hashEmployeeColor(member.id)
  return (
    <span
      className={[
        'rounded-full grid place-items-center font-semibold text-white shrink-0',
        dim,
        color,
        read ? 'ring-2 ring-[var(--color-status-launched)] ring-offset-1 ring-offset-white' : '',
      ].join(' ')}
      title={member.fullName ?? '(unnamed)'}
    >
      {initials}
    </span>
  )
}

function ProgressPill({ label, pct }: { label: string; pct: number | null }) {
  const tone = pct === null ? 'empty' : pct < 40 ? 'low' : pct < 70 ? 'mid' : 'good'
  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] px-2 py-1.5">
      <p className={[
        'text-base font-bold tabular-nums',
        tone === 'empty' ? 'text-[var(--color-lib-text-subtle)]'
        : tone === 'low' ? 'text-[var(--color-priority-high)]'
        : tone === 'mid' ? 'text-[var(--color-priority-medium)]'
        : 'text-[var(--color-lib-accent)]',
      ].join(' ')}>
        {pct === null ? '—' : `${pct}%`}
      </p>
      <p className="text-[9px] uppercase tracking-widest text-[var(--color-lib-text-subtle)] font-semibold">
        {label}
      </p>
    </div>
  )
}

function DocListRow({ doc, busy, onRemove }: {
  doc: DocHubEntry
  busy: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] px-2 py-1.5">
      <DocTypeIcon type={doc.types[0]} size={11} />
      <Link
        to={`/strategy/library/doc/${doc.id}`}
        className="flex-1 min-w-0 text-xs text-[var(--color-lib-text)] truncate hover:text-[var(--color-lib-accent)] hover:underline"
      >
        {doc.title}
      </Link>
      <DeptPill dept={doc.department} />
      <VerifBadge status={doc.verificationStatus} />
      {doc.priorityDoc && (
        <Star size={10} className="fill-[var(--color-lib-accent)] text-[var(--color-lib-accent)]" />
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="text-[var(--color-lib-text-subtle)] hover:text-red-500 disabled:opacity-50"
        title="Remove"
      >
        <X size={11} />
      </button>
    </div>
  )
}

/** Inline searchable doc adder. Type → matching titles → click to add. */
function DocSearchAdder({
  excludeIds, allDocs, placeholder, onAdd, busyId, compact = false,
}: {
  excludeIds: Set<string>
  allDocs: DocHubEntry[]
  placeholder: string
  onAdd: (docId: string) => Promise<void>
  busyId: string | null
  compact?: boolean
}) {
  const [search, setSearch] = useState('')
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [] as DocHubEntry[]
    return allDocs
      .filter(d => !excludeIds.has(d.id))
      .filter(d => d.title.toLowerCase().includes(q))
      .slice(0, 8)
  }, [allDocs, excludeIds, search])

  return (
    <div>
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-lib-text-subtle)]" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={placeholder}
          className={[
            'w-full pl-7 pr-3 rounded-sm border border-[var(--color-lib-border)] bg-white outline-none focus:border-[var(--color-lib-accent)]',
            compact ? 'py-1.5 text-xs' : 'py-2 text-sm',
          ].join(' ')}
        />
      </div>
      {matches.length > 0 && (
        <div className="mt-1 rounded-sm border border-[var(--color-lib-border)] bg-white max-h-44 overflow-y-auto">
          {matches.map(d => (
            <button
              key={d.id}
              type="button"
              onClick={() => onAdd(d.id).then(() => setSearch(''))}
              disabled={busyId === d.id}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--color-lib-bg)] border-b border-[var(--color-lib-border)] last:border-b-0 disabled:opacity-50"
            >
              <DocTypeIcon type={d.types[0]} size={11} />
              <span className="flex-1 truncate text-[var(--color-lib-text)]">{d.title}</span>
              <DeptPill dept={d.department} />
              <Plus size={10} className="text-[var(--color-lib-accent)]" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
