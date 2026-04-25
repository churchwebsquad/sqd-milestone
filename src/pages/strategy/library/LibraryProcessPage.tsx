import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, LibraryDrilldownHeader, DocTypeIcon, UnreadDot,
  DeptPill, VerifBadge,
} from '../../../components/library/LibraryShell'
import { DeptFilterChips } from '../../../components/library/DeptFilterChips'
import { StrategyLoadingCard, StrategyEmptyCard } from '../../../components/strategy/StrategyUI'
import {
  groupMilestones, loadMilestones, squadToStrategyDept, type SquadGroup,
} from '../../../lib/milestoneCatalog'
import { syncWorkflowStepOptions, type WorkflowStepSyncResult } from '../../../lib/strategyNotion'
import type { Department, DocHubEntry } from '../../../types/strategy'
import { StaffAddDocFlyout } from './StaffAddDocFlyout'

const INTERNAL_STAGES = [
  'Internal: Team Onboarding',
  'Internal: Partner Onboarding',
  'Internal: Offboarding',
] as const

/** Process & Workflows — docs grouped by the squad/pathway/step hierarchy
 *  pulled live from `strategy_milestone_definitions` (same source the
 *  Template Editor uses). Docs whose `Workflow Step` value matches a
 *  known `step_name` group under that step; legacy values land in an
 *  "Other tags" section so nothing's hidden. */
export default function LibraryProcessPage() {
  const { loading, docs, myReads, me, defaults, activeVerifier } = useLibraryData()
  const [adding, setAdding] = useState(false)
  const [milestoneGroups, setMilestoneGroups] = useState<SquadGroup[]>([])
  // Default the dept filter to the viewer's own dept (when known) — feels
  // like a personalized landing — but always show the chip row so they
  // know they're filtering and can opt out to "All".
  const [deptFilter, setDeptFilter] = useState<Department | 'all'>(me.department ?? 'all')

  useEffect(() => {
    loadMilestones()
      .then(d => setMilestoneGroups(groupMilestones(d)))
      .catch(() => {/* fall back to legacy-only view */})
  }, [])

  const filtered = useMemo(() => {
    return docs.filter(d => {
      if (!d.groups.includes('Process & Workflows')) return false
      if (deptFilter !== 'all' && d.department !== deptFilter) return false
      return true
    })
  }, [docs, deptFilter])

  // All step_names known to the milestone catalog. Anything in a doc's
  // `workflowSteps` that doesn't appear here is "legacy" / free-form.
  const knownStepNames = useMemo(() => {
    const s = new Set<string>()
    for (const g of milestoneGroups) for (const p of g.pathways) for (const st of p.steps) s.add(st.step_name)
    return s
  }, [milestoneGroups])

  // Internal stages = always shown (onboarding/offboarding) + any other
  // workflow-step values on docs that aren't in the milestone catalog.
  const legacyTags = useMemo(() => {
    const tags = new Set<string>()
    for (const d of filtered) {
      for (const w of d.workflowSteps) {
        if (knownStepNames.has(w)) continue
        if (INTERNAL_STAGES.includes(w as typeof INTERNAL_STAGES[number])) continue
        tags.add(w)
      }
    }
    return [...tags].sort()
  }, [filtered, knownStepNames])

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<WorkflowStepSyncResult | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      setSyncResult(await syncWorkflowStepOptions())
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <LibraryNavBar
        crumbs={[
          { label: 'Library', to: '/strategy/library' },
          { label: 'Process & Workflows' },
        ]}
      />
      <LibraryDrilldownHeader
        title="Process & Workflows"
        actions={
          <div className="flex items-center gap-2">
            {me.isVP && (
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                title="Sync the Notion Workflow Step options with the milestone catalog"
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-lib-border)] bg-white text-sm font-medium text-[var(--color-lib-text)] px-3 py-1.5 hover:border-[var(--color-lib-border-strong)] disabled:opacity-50"
              >
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync workflow steps'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-lib-accent)] text-white text-sm font-medium px-3 py-1.5 hover:bg-[var(--color-lib-accent-hover)]"
            >
              <Plus size={12} />
              Add doc
            </button>
          </div>
        }
      />

      {syncResult && (
        <div className="mb-4 rounded-md border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] p-3 text-sm text-[var(--color-lib-text)]">
          <p className="font-semibold mb-1">Workflow steps synced.</p>
          <p className="text-xs text-[var(--color-lib-text-muted)]">
            Added {syncResult.added.length} new option{syncResult.added.length !== 1 ? 's' : ''}{syncResult.added.length > 0 ? `: ${syncResult.added.join(', ')}` : ''}.
            {' '}Kept {syncResult.kept.length} existing.
            {syncResult.candidatesToDrop.length > 0 && (
              <> {syncResult.candidatesToDrop.length} option{syncResult.candidatesToDrop.length !== 1 ? 's' : ''} not in the catalog ({syncResult.candidatesToDrop.join(', ')}) — Notion blocks deletion of in-use options, so retag those docs first if you want them gone.</>
            )}
          </p>
        </div>
      )}
      {syncError && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Couldn't sync: {syncError}
        </div>
      )}

      <DeptFilterChips value={deptFilter} onChange={setDeptFilter} />

      {loading && filtered.length === 0 && <StrategyLoadingCard label="Loading SOPs…" />}

      {!loading && filtered.length === 0 && (
        <StrategyEmptyCard>
          No Process & Workflows docs yet. Click "Add doc" to create the first one.
        </StrategyEmptyCard>
      )}

      {/* Squads → pathways → steps (live from milestone catalog).
          When a dept chip is selected, hide squads from other depts so
          the page shrinks to the relevant pathways only. The Brand squad
          maps to the `branding` strategy dept; All-In matches every chip. */}
      {milestoneGroups
        .filter(squad => {
          if (deptFilter === 'all') return true
          const sd = squadToStrategyDept(squad.squad)
          return sd === deptFilter || sd === 'all-in'
        })
        .map(squad => (
          <SquadSection
            key={squad.squad}
            squad={squad}
            docs={filtered}
            myReads={myReads}
            onAddDoc={() => setAdding(true)}
          />
        ))}

      {/* Internal stages (onboarding/offboarding) + legacy free-form tags */}
      {(INTERNAL_STAGES.some(s => filtered.some(d => d.workflowSteps.includes(s))) || legacyTags.length > 0) && (
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-lib-text-subtle)] mt-8 mb-3">
          Internal & other tags
        </h3>
      )}
      {INTERNAL_STAGES.map(stage => {
        const stageDocs = filtered.filter(d => d.workflowSteps.includes(stage))
        if (stageDocs.length === 0) return null
        return (
          <FlatStageCard
            key={stage}
            label={stage.replace('Internal: ', '')}
            internal
            docs={stageDocs}
            myReads={myReads}
            onAddDoc={() => setAdding(true)}
          />
        )
      })}
      {legacyTags.map(tag => {
        const stageDocs = filtered.filter(d => d.workflowSteps.includes(tag))
        if (stageDocs.length === 0) return null
        return (
          <FlatStageCard
            key={tag}
            label={tag}
            internal={false}
            legacy
            docs={stageDocs}
            myReads={myReads}
            onAddDoc={() => setAdding(true)}
          />
        )
      })}

      {adding && (
        <StaffAddDocFlyout
          defaultDept={me.department}
          activeVerifier={activeVerifier}
          defaults={defaults}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  )
}

// ── Squad section: header + each pathway as its own stage card ───────────

function SquadSection({ squad, docs, myReads, onAddDoc }: {
  squad: SquadGroup
  docs: DocHubEntry[]
  myReads: Set<string>
  onAddDoc: () => void
}) {
  // Render every pathway in the catalog — even ones with no docs yet — so
  // directors can see the full milestone surface and notice gaps where
  // SOPs haven't been written.
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-lib-accent)] mb-2">
        {squad.squadLabel}
      </h3>
      {squad.pathways.map(path => (
        <PathwayStageCard
          key={path.pathway}
          label={path.pathwayLabel}
          steps={path.steps.map(s => ({
            stepNumber: s.step_number,
            stepName: s.step_name,
            docs: docs.filter(d => d.workflowSteps.includes(s.step_name)),
          }))}
          myReads={myReads}
          onAddDoc={onAddDoc}
        />
      ))}
    </div>
  )
}

function PathwayStageCard({ label, steps, myReads, onAddDoc }: {
  label: string
  steps: Array<{ stepNumber: number; stepName: string; docs: DocHubEntry[] }>
  myReads: Set<string>
  onAddDoc: () => void
}) {
  const totalDocs = steps.reduce((n, s) => n + s.docs.length, 0)
  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] mb-3 overflow-hidden">
      <div
        className="flex items-center gap-3 p-4 border-b border-[var(--color-lib-border)]"
        style={{ background: 'linear-gradient(180deg, var(--color-lib-surface), var(--color-lib-bg))' }}
      >
        <div className="flex-1">
          <div className="text-base font-semibold tracking-tight text-[var(--color-lib-text)]">
            {label}
          </div>
          <div className="text-[11px] text-[var(--color-lib-text-muted)]">
            {steps.length} step{steps.length !== 1 ? 's' : ''} · partner-facing pathway
          </div>
        </div>
        <span className="text-[11px] text-[var(--color-lib-text-subtle)]">
          {totalDocs} doc{totalDocs !== 1 ? 's' : ''}
        </span>
      </div>
      {steps.map(step => (
        <div key={step.stepNumber} className="border-b border-[var(--color-lib-border)] last:border-b-0">
          <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-lib-text-muted)] bg-[var(--color-lib-bg)] flex items-center gap-2">
            <span className="flex-1">Step {step.stepNumber}: {step.stepName}</span>
            {step.docs.length === 0 && (
              <span className="text-[10px] text-[var(--color-lib-text-subtle)] italic normal-case tracking-normal">
                No docs yet
              </span>
            )}
          </div>
          {step.docs.map(d => <DocRow key={d.id} doc={d} unread={!myReads.has(d.id)} />)}
        </div>
      ))}
      <button
        type="button"
        onClick={onAddDoc}
        className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--color-lib-accent)] border-t border-dashed border-[var(--color-lib-border)] hover:bg-[var(--color-lib-accent-soft)] w-full text-left"
      >
        <Plus size={12} />
        Add a doc to {label}
      </button>
    </div>
  )
}

function FlatStageCard({ label, internal, legacy, docs, myReads, onAddDoc }: {
  label: string
  internal: boolean
  legacy?: boolean
  docs: DocHubEntry[]
  myReads: Set<string>
  onAddDoc: () => void
}) {
  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] mb-3 overflow-hidden">
      <div
        className="flex items-center gap-3 p-4 border-b border-[var(--color-lib-border)]"
        style={{ background: 'linear-gradient(180deg, var(--color-lib-surface), var(--color-lib-bg))' }}
      >
        <div className="flex-1">
          <div className="text-base font-semibold tracking-tight text-[var(--color-lib-text)]">
            {label}
          </div>
          <div className="text-[11px] text-[var(--color-lib-text-muted)]">
            {internal ? 'Internal milestone' : legacy ? 'Legacy tag' : 'Workflow tag'}
          </div>
        </div>
        <span className="text-[11px] text-[var(--color-lib-text-subtle)]">
          {docs.length} doc{docs.length !== 1 ? 's' : ''}
        </span>
      </div>
      {docs.map(d => <DocRow key={d.id} doc={d} unread={!myReads.has(d.id)} />)}
      <button
        type="button"
        onClick={onAddDoc}
        className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--color-lib-accent)] border-t border-dashed border-[var(--color-lib-border)] hover:bg-[var(--color-lib-accent-soft)] w-full text-left"
      >
        <Plus size={12} />
        Add a doc to {label}
      </button>
    </div>
  )
}

function DocRow({ doc, unread }: { doc: DocHubEntry; unread: boolean }) {
  return (
    <Link
      to={`/strategy/library/doc/${doc.id}`}
      className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-4 py-3 border-b border-[var(--color-lib-border)] last:border-b-0 hover:bg-[var(--color-lib-accent-soft)]"
    >
      <div className="w-7 h-7 rounded-sm bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] grid place-items-center shrink-0">
        <DocTypeIcon type={doc.types[0]} size={14} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--color-lib-text)] flex items-center gap-2">
          <span className="truncate">{doc.title}</span>
          {unread && <UnreadDot />}
        </div>
        <div className="flex gap-1.5 items-center text-[11px] text-[var(--color-lib-text-muted)] mt-0.5">
          <DeptPill dept={doc.department} />
          <span>{doc.types[0] ?? '—'}</span>
          <VerifBadge status={doc.verificationStatus} />
        </div>
      </div>
      <span className="text-[11px] text-[var(--color-lib-text-subtle)] whitespace-nowrap">
        {doc.lastEditedTime ? formatShort(doc.lastEditedTime) : ''}
      </span>
      <ChevronRight size={14} className="text-[var(--color-lib-text-subtle)]" />
    </Link>
  )
}

function formatShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

