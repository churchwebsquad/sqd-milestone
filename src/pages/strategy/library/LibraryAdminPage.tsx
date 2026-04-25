import { useEffect, useState } from 'react'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, LibraryDrilldownHeader, DeptPill,
} from '../../../components/library/LibraryShell'
import { StrategyEmptyCard } from '../../../components/strategy/StrategyUI'
import {
  endDelegation, listStaffEmployees, setDelegate, setDirector,
} from '../../../lib/library'
import type { Department, EmployeeRef, VerifierDefault } from '../../../types/strategy'

const DEPT_ORDER: Department[] = ['web', 'branding', 'social', 'all-in']

/** Verification Settings — VP only. Edit each department's default
 *  verifier; toggle delegation when a director is OOO. */
export default function LibraryAdminPage() {
  const { me, defaults, applyDefaultUpdate } = useLibraryData()
  const [employees, setEmployees] = useState<EmployeeRef[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    if (!me.isVP) return
    listStaffEmployees()
      .then(setEmployees)
      .catch(err => setLoadErr(err instanceof Error ? err.message : String(err)))
  }, [me.isVP])

  if (!me.isVP) {
    return (
      <>
        <LibraryNavBar
          crumbs={[
            { label: 'Library', to: '/strategy/library' },
            { label: 'Verification Settings' },
          ]}
        />
        <LibraryDrilldownHeader title="Verification Settings" />
        <StrategyEmptyCard>
          VP only. Verification routing is managed by the VP of Strategy.
        </StrategyEmptyCard>
      </>
    )
  }

  return (
    <>
      <LibraryNavBar
        crumbs={[
          { label: 'Library', to: '/strategy/library' },
          { label: 'Verification Settings' },
        ]}
      />
      <LibraryDrilldownHeader title="Verification Settings" />

      <Section title="Department review routing" desc="When a doc with status Needs Verification is added in a department, it routes to that department's verifier. Use Delegate temporarily — vacation, role transitions — to swap the verifier without losing the original assignment.">
        {loadErr && <p className="text-xs text-red-600 mb-3">Couldn't load employees: {loadErr}</p>}
        {DEPT_ORDER.map(dept => {
          const row = defaults.find(d => d.dept === dept)
          if (!row) return null
          return (
            <VerifierRow
              key={dept}
              dept={dept}
              row={row}
              employees={employees ?? []}
              callerEmployeeId={me.employeeId!}
              onUpdated={applyDefaultUpdate}
            />
          )
        })}
      </Section>

      <Section
        title="Per-doc verification overrides"
        desc="For unusual cases — a Web-tagged doc that needs Brand sign-off, etc. — you'll be able to override the verifier on individual docs in a future phase. None set today."
      >
        <p className="text-xs text-[var(--color-lib-text-subtle)] italic">
          Coming in a later phase — would add a Verification Owner property to the Notion Doc Hub.
        </p>
      </Section>

      <Section
        title="Who can add docs?"
        desc="All staff can create new docs. New docs are saved with status Needs Verification and routed to the department verifier above. Staff cannot publish without director sign-off."
      >
        {/* No content — desc carries the whole point */}
      </Section>
    </>
  )
}

function Section({ title, desc, children }: {
  title: string
  desc: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-5 mb-4">
      <h2 className="text-base font-semibold tracking-tight text-[var(--color-lib-text)] mb-2">
        {title}
      </h2>
      <p className="text-sm text-[var(--color-lib-text-muted)] leading-relaxed mb-4">
        {desc}
      </p>
      {children}
    </div>
  )
}

function VerifierRow({
  dept, row, employees, callerEmployeeId, onUpdated,
}: {
  dept: Department
  row: VerifierDefault
  employees: EmployeeRef[]
  callerEmployeeId: string
  onUpdated: (next: VerifierDefault) => void
}) {
  const director = employees.find(e => e.id === row.directorEmployeeId)
  const delegate = row.delegateEmployeeId
    ? employees.find(e => e.id === row.delegateEmployeeId) ?? null
    : null
  const [editing, setEditing] = useState<'director' | 'delegate' | null>(null)
  const [picking, setPicking] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!picking) { setError('Pick someone'); return }
    setSaving(true)
    setError(null)
    try {
      const next = editing === 'director'
        ? await setDirector(dept, picking, callerEmployeeId)
        : await setDelegate(dept, picking, null, callerEmployeeId)
      onUpdated(next)
      setEditing(null)
      setPicking('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleEndDelegation = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await endDelegation(dept, callerEmployeeId)
      onUpdated(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] px-4 py-3 mb-2">
      <div className="grid grid-cols-[120px_1fr_auto_auto] gap-3 items-center">
        <div><DeptPill dept={dept} /></div>
        <div className="text-sm text-[var(--color-lib-text)] flex items-center gap-2 flex-wrap">
          <strong>{director?.fullName ?? 'Unassigned'}</strong>
          {director?.role && <span className="text-[var(--color-lib-text-muted)]">· {director.role}</span>}
          {delegate && (
            <span className="rounded-sm bg-[#FEF3C7] text-[var(--color-priority-medium)] text-[11px] font-medium px-2 py-0.5">
              ⚠ Delegated to {delegate.fullName ?? 'someone'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setEditing('director'); setPicking(row.directorEmployeeId) }}
          className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2.5 py-1 hover:border-[var(--color-lib-border-strong)]"
        >
          Change
        </button>
        {delegate ? (
          <button
            type="button"
            onClick={handleEndDelegation}
            disabled={saving}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2.5 py-1 hover:border-[var(--color-lib-border-strong)] disabled:opacity-50"
          >
            End delegation
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setEditing('delegate'); setPicking('') }}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2.5 py-1 hover:border-[var(--color-lib-border-strong)]"
          >
            Delegate
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t border-[var(--color-lib-border)] flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--color-lib-text-muted)]">
            {editing === 'director' ? 'Set director to:' : 'Delegate to:'}
          </span>
          <select
            value={picking}
            onChange={e => setPicking(e.target.value)}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white px-2 py-1 text-sm flex-1 max-w-md"
          >
            <option value="">— Pick someone —</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.fullName ?? e.email ?? '(unnamed)'} {e.role ? `· ${e.role}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !picking}
            className="rounded-sm bg-[var(--color-lib-accent)] text-white text-xs font-medium px-2.5 py-1 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(null); setPicking(''); setError(null) }}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2.5 py-1"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
