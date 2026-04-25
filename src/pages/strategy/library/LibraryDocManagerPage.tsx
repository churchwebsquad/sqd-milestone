/**
 * Doc Manager — director/VP-only consolidated view of every doc in the
 * Library. Replaces the scattered actions previously living on the
 * Review Queue, Doc Detail, Process page diagnostic, and Recent Updates
 * pages by collecting them in one CRM-style power view:
 *
 *   - Three top-level buckets: Needs Verification / Suggested / Library
 *   - Per-bucket: searchable, filterable, sortable table with multi-select
 *   - Bulk action bar appears when ≥ 1 row selected
 *   - Click row → side panel with full per-doc actions + inline edits
 *   - Below the buckets: Milestone & Pathway editor (CRUD on
 *     `strategy_milestone_definitions` — the same source the Template
 *     Editor reads from, with a rollup of #docs and #templates per step)
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Archive, Check, ChevronDown, ChevronRight, ExternalLink,
  Filter, GripVertical, ListChecks, Loader2, Pencil, Plus,
  Search, Settings, Sparkles, Star, Trash2, Users, X,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  LibraryNavBar, LibraryDrilldownHeader, DocTypeIcon, DeptPill,
  VerifBadge,
} from '../../../components/library/LibraryShell'
import { StrategyEmptyCard, StrategyLoadingCard } from '../../../components/strategy/StrategyUI'
import {
  archivePage, listDocCommentsBulk, updateDoc, verifyDoc,
} from '../../../lib/strategyNotion'
import {
  addMilestoneDefinition, archiveMilestoneDefinition, listAllMilestoneDefinitions,
  reorderMilestoneDefinitions, setDocRequired, unsetDocRequired,
  updateMilestoneDefinition,
  type MilestoneDefinitionRow,
} from '../../../lib/library'
import {
  groupMilestones, type SquadGroup,
} from '../../../lib/milestoneCatalog'
import { DocFlyout } from '../../../components/library/DocFlyout'
import { SquadProgress } from '../../../components/library/SquadProgress'
import { supabase } from '../../../lib/supabase'
import type {
  DocHubEntry, Department, VerificationStatus,
} from '../../../types/strategy'
import type { DocCommentSummary } from '../../../lib/strategyNotion'

type Bucket = 'needs-verification' | 'suggested' | 'library' | 'squad' | 'milestones'

const DEPT_LABEL: Record<Department, string> = {
  'all-in': 'All In', web: 'Web', branding: 'Brand', social: 'Social',
}


export default function LibraryDocManagerPage() {
  const { docs, me, applyDocUpdate, applyDocArchived, requiredReading } = useLibraryData()

  if (!me.isDirector) {
    return (
      <>
        <LibraryNavBar
          crumbs={[
            { label: 'Library', to: '/strategy/library' },
            { label: 'Doc Manager' },
          ]}
        />
        <LibraryDrilldownHeader title="Doc Manager" />
        <StrategyEmptyCard>
          The Doc Manager is for directors and VP. Reach out to your director if you need to verify, archive, or assign docs.
        </StrategyEmptyCard>
      </>
    )
  }

  return (
    <>
      <LibraryNavBar
        crumbs={[
          { label: 'Library', to: '/strategy/library' },
          { label: 'Doc Manager' },
        ]}
      />
      <LibraryDrilldownHeader
        title="Doc Manager"
        subtitle="Verify, archive, tag, and assign docs in bulk. Manage squad assignments and the milestone catalog from the tabs."
      />

      <DocBucketTabs
        docs={docs}
        applyDocUpdate={applyDocUpdate}
        applyDocArchived={applyDocArchived}
        requiredReading={requiredReading}
      />
    </>
  )
}

// ── Bucket tabs + table ──────────────────────────────────────────────────

function DocBucketTabs({ docs, applyDocUpdate, applyDocArchived, requiredReading }: {
  docs: DocHubEntry[]
  applyDocUpdate: (next: DocHubEntry) => void
  applyDocArchived: (id: string) => void
  requiredReading: Set<string>
}) {
  // The current tab is in the URL so deep-links from elsewhere (e.g.
  // "Open Doc Manager" → ?tab=onboarding) land on the right view.
  const [params, setParams] = useSearchParams()
  const initialBucket = (params.get('tab') as Bucket | null) ?? 'needs-verification'
  const [bucket, setBucket] = useState<Bucket>(initialBucket)
  useEffect(() => {
    if (params.get('tab') !== bucket) {
      const next = new URLSearchParams(params)
      next.set('tab', bucket)
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket])

  /** Bucket assignment for the doc-table tabs:
   *   - Suggested: docs tagged with the "Suggested Document" type (VP-
   *     suggested doc prompts). We used to match on the "Draft" group
   *     but Group doubles as a content taxonomy so the rule was
   *     ambiguous; switching to a dedicated type tag makes the
   *     classification explicit.
   *   - Needs Verification: needs-verification, outdated, OR
   *     in-progress, AND not Suggested. All three states require
   *     director attention — outdated docs surface here with a distinct
   *     badge, in-progress docs are mid-review.
   *   - Verified Docs: only fully-verified docs (the "trusted" library).
   *  The Manage Squad tab renders different content entirely (the
   *  SquadProgress widget). */
  const buckets = useMemo(() => {
    const needs: DocHubEntry[] = []
    const suggested: DocHubEntry[] = []
    const library: DocHubEntry[] = []
    for (const d of docs) {
      if (d.types.includes('Suggested Document')) suggested.push(d)
      else if (
        d.verificationStatus === 'needs-verification' ||
        d.verificationStatus === 'outdated' ||
        d.verificationStatus === 'in-progress'
      ) needs.push(d)
      else library.push(d)
    }
    return { needs, suggested, library }
  }, [docs])

  const tableDocs =
    bucket === 'needs-verification' ? buckets.needs
    : bucket === 'library' ? buckets.library
    : null

  return (
    <>
      <div className="flex items-center gap-1.5 rounded-md bg-[var(--color-lib-bg)] border border-[var(--color-lib-border)] p-1 mb-4 overflow-x-auto">
        <BucketTab
          label="Needs Verification"
          count={buckets.needs.length}
          active={bucket === 'needs-verification'}
          onClick={() => setBucket('needs-verification')}
          icon={<ListChecks size={12} />}
        />
        <BucketTab
          label="Suggested"
          count={buckets.suggested.length}
          active={bucket === 'suggested'}
          onClick={() => setBucket('suggested')}
          icon={<Sparkles size={12} />}
        />
        <BucketTab
          label="Verified Docs"
          count={buckets.library.length}
          active={bucket === 'library'}
          onClick={() => setBucket('library')}
          icon={<Archive size={12} />}
        />
        <span className="w-px h-5 bg-[var(--color-lib-border)] mx-1" />
        <BucketTab
          label="Manage Squad"
          active={bucket === 'squad'}
          onClick={() => setBucket('squad')}
          icon={<Users size={12} />}
        />
        <BucketTab
          label="Milestones & Pathways"
          active={bucket === 'milestones'}
          onClick={() => setBucket('milestones')}
          icon={<Settings size={12} />}
        />
      </div>

      {tableDocs && (
        <DocTable
          bucket={bucket as 'needs-verification' | 'library'}
          docs={tableDocs}
          applyDocUpdate={applyDocUpdate}
          applyDocArchived={applyDocArchived}
          requiredReading={requiredReading}
        />
      )}

      {bucket === 'suggested' && (
        <SuggestedCards
          docs={buckets.suggested}
          applyDocUpdate={applyDocUpdate}
          applyDocArchived={applyDocArchived}
        />
      )}

      {bucket === 'squad' && (
        <div className="mb-6">
          <SquadProgress />
        </div>
      )}

      {bucket === 'milestones' && (
        <div className="mb-6">
          <MilestonePathwayEditor docs={docs} />
        </div>
      )}
    </>
  )
}

/** Suggested-doc cards. Each card leads with the VP's note (the comment
 *  posted when the doc was suggested) so the director sees the prompt
 *  first, with one-click actions to write the body or open in Notion. */
function SuggestedCards({ docs, applyDocUpdate, applyDocArchived }: {
  docs: DocHubEntry[]
  applyDocUpdate: (next: DocHubEntry) => void
  applyDocArchived: (id: string) => void
}) {
  const [commentsByDoc, setCommentsByDoc] = useState<Record<string, DocCommentSummary[]>>({})
  const [openDoc, setOpenDoc] = useState<DocHubEntry | null>(null)

  const docIds = useMemo(() => docs.map(d => d.id), [docs])
  useEffect(() => {
    if (docIds.length === 0) return
    let cancelled = false
    listDocCommentsBulk(docIds)
      .then(map => { if (!cancelled) setCommentsByDoc(map) })
      .catch(() => {/* silent */})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docIds.join('|')])

  if (docs.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-lib-border)] bg-white p-6 text-center mb-6">
        <Sparkles size={20} className="mx-auto mb-2 text-[var(--color-lib-accent)]" />
        <p className="text-sm font-semibold text-[var(--color-lib-text)] mb-1">
          No suggested docs right now
        </p>
        <p className="text-xs text-[var(--color-lib-text-muted)]">
          When the VP uses "Suggest a doc", prompts appear here. Open one and write the body in Notion or via the in-app editor — submitting moves it to Needs Verification.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 mb-6">
      <p className="text-[11px] text-[var(--color-lib-text-muted)] leading-relaxed">
        VP-suggested doc prompts. Each card leads with the framing the VP wrote — open the doc to write the body, verify it when complete, or archive if it's no longer needed.
      </p>
      {docs.map(doc => {
        const comments = commentsByDoc[doc.id] ?? []
        const lead = comments[0] ?? null
        const date = lead?.createdAt
          ? new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : null
        return (
          <div
            key={doc.id}
            className="rounded-lg border border-[var(--color-lib-accent)] bg-[var(--color-lib-accent-soft)] overflow-hidden"
          >
            {lead && (
              <div className="px-5 py-4 border-b border-[var(--color-lib-accent)]/30 bg-white/40">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-accent)] mb-1.5">
                  Note from {lead.authorName ?? 'VP'} · {date ?? ''}
                </p>
                <p className="text-sm text-[var(--color-lib-text)] leading-relaxed whitespace-pre-wrap">
                  {lead.text}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setOpenDoc(doc)}
              className="w-full text-left px-5 py-3 hover:bg-white/40 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <DocTypeIcon type={doc.types[0]} size={13} />
                <h3 className="text-sm font-semibold text-[var(--color-lib-text)] flex-1 min-w-0 truncate">
                  {doc.title}
                </h3>
                <DeptPill dept={doc.department} />
                <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-lib-accent)] text-white text-[10px] font-semibold uppercase tracking-widest px-2 py-1 whitespace-nowrap">
                  Open & write →
                </span>
              </div>
              {comments.length > 1 && (
                <p className="text-[11px] text-[var(--color-lib-text-subtle)] mt-1">
                  +{comments.length - 1} more comment{comments.length - 1 === 1 ? '' : 's'} on the page
                </p>
              )}
            </button>
          </div>
        )
      })}

      {openDoc && (
        <DocFlyout
          docId={openDoc.id}
          queueDocs={docs}
          mode="suggested"
          onClose={() => setOpenDoc(null)}
          onUpdated={applyDocUpdate}
          onArchived={applyDocArchived}
          onNavigate={(id) => setOpenDoc(docs.find(d => d.id === id) ?? null)}
        />
      )}
    </div>
  )
}

function BucketTab({ label, count, active, onClick, icon }: {
  label: string; count?: number; active: boolean; onClick: () => void; icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-sm text-xs font-medium px-3 py-1.5 transition-colors whitespace-nowrap',
        active
          ? 'bg-white text-[var(--color-lib-text)] shadow-sm'
          : 'text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-text)]',
      ].join(' ')}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className={[
          'ml-1 rounded-full px-1.5 py-px text-[10px] font-semibold',
          active ? 'bg-[var(--color-lib-accent)] text-white' : 'bg-[var(--color-lib-border)] text-[var(--color-lib-text-muted)]',
        ].join(' ')}>
          {count}
        </span>
      )}
    </button>
  )
}

// ── Doc table + multi-select + bulk actions + side panel ────────────────

function DocTable({ bucket, docs, applyDocUpdate, applyDocArchived, requiredReading }: {
  bucket: 'needs-verification' | 'suggested' | 'library'
  docs: DocHubEntry[]
  applyDocUpdate: (next: DocHubEntry) => void
  applyDocArchived: (id: string) => void
  requiredReading: Set<string>
}) {
  const { me } = useLibraryData()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState<Department | 'all'>('all')
  const [verifFilter, setVerifFilter] = useState<VerificationStatus | 'all'>('all')
  const [flagFilter, setFlagFilter] = useState<'all' | 'untagged' | 'mismatched' | 'missing-dept'>('all')
  const [sort, setSort] = useState<'recent' | 'title' | 'verification'>('recent')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openDoc, setOpenDoc] = useState<DocHubEntry | null>(null)

  // Reset selection when bucket changes (selections shouldn't carry over).
  useEffect(() => { setSelected(new Set()) }, [bucket])

  /** Known milestone step names — used to detect mismatched workflow tags
   *  (a doc tagged with a step that doesn't exist in the catalog). Loaded
   *  once on mount; falls back to an empty set if the catalog isn't
   *  available yet. */
  const [knownStepNames, setKnownStepNames] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (bucket !== 'library') return
    listAllMilestoneDefinitions()
      .then(rows => setKnownStepNames(new Set(rows.filter(r => r.is_active).map(r => r.step_name))))
      .catch(() => {/* fallback to empty — disables mismatched detection */})
  }, [bucket])

  /** Pre-compute per-doc flags so the chip counts stay in sync with the
   *  filter pass. A doc can satisfy multiple flags at once.
   *
   *  Untagged is only meaningful for docs in the "Process & Workflows"
   *  group — that's the only taxonomy that renders the workflow tree
   *  on the partner-facing views. Docs in other groups (Resources,
   *  Culture, Strategy, Draft) genuinely have no workflow step, so
   *  flagging them was generating false positives. */
  const isProcessGroup = (d: DocHubEntry) => d.groups.includes('Process & Workflows')
  const isUntagged = (d: DocHubEntry) =>
    isProcessGroup(d) && d.workflowSteps.length === 0
  const isMissingDept = (d: DocHubEntry) => d.department === null
  const isMismatched = (d: DocHubEntry) => {
    if (knownStepNames.size === 0) return false
    return d.workflowSteps.some(s =>
      !knownStepNames.has(s) && !s.startsWith('Internal:'),
    )
  }

  const flagCounts = useMemo(() => ({
    untagged: docs.filter(isUntagged).length,
    mismatched: docs.filter(isMismatched).length,
    missingDept: docs.filter(isMissingDept).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [docs, knownStepNames])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = docs
      .filter(d => deptFilter === 'all' || d.department === deptFilter)
      .filter(d => verifFilter === 'all' || d.verificationStatus === verifFilter)
      .filter(d => {
        if (flagFilter === 'untagged') return isUntagged(d)
        if (flagFilter === 'mismatched') return isMismatched(d)
        if (flagFilter === 'missing-dept') return isMissingDept(d)
        return true
      })
      .filter(d => !q || d.title.toLowerCase().includes(q))
    if (sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'verification') {
      const order: Record<string, number> = { 'needs-verification': 0, 'in-progress': 1, 'verified': 2 }
      out.sort((a, b) => (order[a.verificationStatus ?? 'verified'] ?? 99) - (order[b.verificationStatus ?? 'verified'] ?? 99))
    } else out.sort((a, b) => (b.lastEditedTime ?? '').localeCompare(a.lastEditedTime ?? ''))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, search, deptFilter, verifFilter, sort, flagFilter, knownStepNames])

  const allChecked = filtered.length > 0 && filtered.every(d => selected.has(d.id))
  const toggleAll = () => {
    if (allChecked) {
      setSelected(prev => {
        const next = new Set(prev)
        for (const d of filtered) next.delete(d.id)
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        for (const d of filtered) next.add(d.id)
        return next
      })
    }
  }
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-white overflow-hidden mb-6">
      {/* Health-check chips — surface library docs that need attention.
          Active on the Library bucket. Each pill flips between a
          warning state (when there *are* docs that match the criterion)
          and a success state (count === 0). Showing the row even when
          everything's clean lets the user confirm at a glance that
          there's nothing to triage, which was previously ambiguous —
          the row used to disappear entirely on a clean catalog. */}
      {bucket === 'library' && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-lib-border)] bg-[#FEF3C7]/30 flex-wrap text-xs">
          <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-priority-medium)]">
            Health check
          </span>
          <FlagChip
            label="Untagged"
            count={flagCounts.untagged}
            active={flagFilter === 'untagged'}
            onClick={() => setFlagFilter(flagFilter === 'untagged' ? 'all' : 'untagged')}
            tooltip="Docs with no Workflow Step value — won't appear in the Process & Workflows tree."
          />
          <FlagChip
            label="Mismatched workflow"
            count={flagCounts.mismatched}
            active={flagFilter === 'mismatched'}
            onClick={() => setFlagFilter(flagFilter === 'mismatched' ? 'all' : 'mismatched')}
            tooltip="Docs tagged with a step that no longer exists in the milestone catalog."
          />
          <FlagChip
            label="Missing dept"
            count={flagCounts.missingDept}
            active={flagFilter === 'missing-dept'}
            onClick={() => setFlagFilter(flagFilter === 'missing-dept' ? 'all' : 'missing-dept')}
            tooltip="Docs with no Department set — they default to All In on partner views."
          />
          {flagFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setFlagFilter('all')}
              className="ml-auto text-[11px] font-semibold text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-text)] underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-lib-border)] flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-lib-text-subtle)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title…"
            className="w-full pl-7 pr-3 py-1.5 rounded-sm border border-[var(--color-lib-border)] bg-white text-xs outline-none focus:border-[var(--color-lib-accent)]"
          />
        </div>
        <FilterSelect
          icon={<Filter size={11} />}
          value={deptFilter}
          onChange={v => setDeptFilter(v as Department | 'all')}
          options={[
            { value: 'all', label: 'All depts' },
            { value: 'all-in', label: 'All In' },
            { value: 'web', label: 'Web' },
            { value: 'branding', label: 'Brand' },
            { value: 'social', label: 'Social' },
          ]}
        />
        {bucket === 'needs-verification' && (
          <FilterSelect
            value={verifFilter}
            onChange={v => setVerifFilter(v as VerificationStatus | 'all')}
            options={[
              { value: 'all', label: 'Any status' },
              { value: 'needs-verification', label: 'Needs Verification' },
              { value: 'in-progress', label: 'In Progress' },
              { value: 'outdated', label: 'Outdated' },
            ]}
          />
        )}
        <FilterSelect
          value={sort}
          onChange={v => setSort(v as 'recent' | 'title' | 'verification')}
          options={[
            { value: 'recent', label: 'Sort: Recent' },
            { value: 'title', label: 'Sort: Title' },
            { value: 'verification', label: 'Sort: Verification' },
          ]}
        />
        <span className="text-[11px] text-[var(--color-lib-text-subtle)] whitespace-nowrap">
          {filtered.length} of {docs.length}
        </span>
      </div>

      {selected.size > 0 && (
        <BulkActionBar
          bucket={bucket}
          selectedIds={[...selected]}
          allDocs={docs}
          requiredReading={requiredReading}
          onClear={() => setSelected(new Set())}
          applyDocUpdate={applyDocUpdate}
          applyDocArchived={applyDocArchived}
        />
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--color-lib-text-muted)] italic text-center">
          No docs in this view.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-lib-bg)] text-[10px] uppercase tracking-widest text-[var(--color-lib-text-subtle)] font-semibold">
              <tr>
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left w-32">Dept</th>
                <th className="px-3 py-2 text-left w-32">Group</th>
                <th className="px-3 py-2 text-left w-28">Type</th>
                <th className="px-3 py-2 text-left w-44">Workflow Step</th>
                <th className="px-3 py-2 text-left w-32">Verification</th>
                <th className="px-3 py-2 text-center w-16">Onboard</th>
                <th className="px-3 py-2 text-center w-16">Required</th>
                <th className="px-3 py-2 text-right w-20">Edited</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <DocRow
                  key={d.id}
                  doc={d}
                  selected={selected.has(d.id)}
                  onToggle={() => toggleOne(d.id)}
                  onClick={() => setOpenDoc(d)}
                  isRequired={requiredReading.has(d.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openDoc && (
        <DocFlyout
          docId={openDoc.id}
          queueDocs={filtered}
          mode="review"
          onClose={() => setOpenDoc(null)}
          onUpdated={applyDocUpdate}
          onArchived={applyDocArchived}
          onNavigate={(id) => setOpenDoc(filtered.find(d => d.id === id) ?? null)}
        />
      )}
    </div>
  )
}

/** Inline filter chip used by the Library tab's health-check row.
 *  Click toggles the filter on/off; tooltip explains the criterion.
 *  Visual state depends on `count`:
 *    - count > 0 → amber warning style (with AlertTriangle icon)
 *    - count === 0 → green success style (with Check icon)
 *  When the chip is in success state we also disable the click — there's
 *  nothing to filter to, so toggling would just empty the table. */
function FlagChip({ label, count, active, onClick, tooltip }: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  tooltip: string
}) {
  const hasIssues = count > 0
  const tone = hasIssues
    ? (active
        ? 'bg-[var(--color-priority-medium)] border-[var(--color-priority-medium)] text-white'
        : 'bg-white border-[#F59E0B]/40 text-[var(--color-priority-medium)] hover:border-[var(--color-priority-medium)]')
    : 'bg-white border-[var(--color-status-launched)]/40 text-[var(--color-status-launched)] cursor-default'
  const countTone = hasIssues
    ? (active ? 'bg-white/30 text-white' : 'bg-[#FEF3C7] text-[var(--color-priority-medium)]')
    : 'bg-[var(--color-verif-verified-bg)] text-[var(--color-verif-verified-fg)]'
  return (
    <button
      type="button"
      onClick={hasIssues ? onClick : undefined}
      disabled={!hasIssues}
      title={hasIssues ? tooltip : `${tooltip} — clear, no issues found.`}
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border whitespace-nowrap',
        tone,
      ].join(' ')}
    >
      {hasIssues ? <AlertTriangle size={10} /> : <Check size={10} />}
      {label}
      <span className={['rounded-full px-1.5 py-px text-[9px] font-semibold', countTone].join(' ')}>
        {count}
      </span>
    </button>
  )
}

function FilterSelect({ icon, value, onChange, options }: {
  icon?: React.ReactNode
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white px-2 py-1 text-xs">
      {icon}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent outline-none text-[var(--color-lib-text-muted)]"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function DocRow({ doc, selected, onToggle, onClick, isRequired }: {
  doc: DocHubEntry
  selected: boolean
  onToggle: () => void
  onClick: () => void
  isRequired: boolean
}) {
  return (
    <tr
      className={[
        'border-t border-[var(--color-lib-border)] hover:bg-[var(--color-lib-bg)] cursor-pointer',
        selected ? 'bg-[var(--color-lib-accent-soft)]' : '',
      ].join(' ')}
      onClick={onClick}
    >
      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${doc.title}`} />
      </td>
      <td className="px-3 py-2 max-w-[280px]">
        <div className="flex items-center gap-2 min-w-0">
          <DocTypeIcon type={doc.types[0]} size={12} />
          <span className="truncate text-[var(--color-lib-text)] font-medium">{doc.title}</span>
        </div>
      </td>
      <td className="px-3 py-2"><DeptPill dept={doc.department} /></td>
      <td className="px-3 py-2 truncate text-[var(--color-lib-text-muted)]">{doc.groups.join(', ') || '—'}</td>
      <td className="px-3 py-2 truncate text-[var(--color-lib-text-muted)]">{doc.types.join(', ') || '—'}</td>
      <td className="px-3 py-2 truncate text-[var(--color-lib-text-muted)]" title={doc.workflowSteps.join(' · ')}>
        {doc.workflowSteps.length === 0
          ? doc.groups.includes('Process & Workflows')
            ? <span className="italic text-[var(--color-priority-medium)]">untagged</span>
            : <span className="text-[var(--color-lib-text-subtle)]">—</span>
          : doc.workflowSteps.join(' · ')}
      </td>
      <td className="px-3 py-2"><VerifBadge status={doc.verificationStatus} /></td>
      <td className="px-3 py-2 text-center">
        {doc.priorityDoc ? <Star size={12} className="inline fill-[var(--color-lib-accent)] text-[var(--color-lib-accent)]" /> : <span className="text-[var(--color-lib-text-subtle)]">—</span>}
      </td>
      <td className="px-3 py-2 text-center">
        {isRequired ? <Star size={12} className="inline fill-[var(--color-priority-medium)] text-[var(--color-priority-medium)]" /> : <span className="text-[var(--color-lib-text-subtle)]">—</span>}
      </td>
      <td className="px-3 py-2 text-right text-[var(--color-lib-text-subtle)] whitespace-nowrap">
        {doc.lastEditedTime ? new Date(doc.lastEditedTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
      </td>
    </tr>
  )
}

// ── Bulk action bar ──────────────────────────────────────────────────────

const DOC_GROUPS = ['Process & Workflows', 'Resources & Tools', 'Culture & Policies', 'Strategy & Planning', 'Draft']
const DOC_TYPES = ['SOP', 'Guide', 'Template', 'Onboarding & Offboarding', 'Partner-facing', 'Suggested Document']

function BulkActionBar({
  bucket, selectedIds, allDocs, requiredReading, onClear,
  applyDocUpdate, applyDocArchived,
}: {
  bucket: Bucket
  selectedIds: string[]
  allDocs: DocHubEntry[]
  requiredReading: Set<string>
  onClear: () => void
  applyDocUpdate: (next: DocHubEntry) => void
  applyDocArchived: (id: string) => void
}) {
  const { me } = useLibraryData()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedDocs = useMemo(
    () => allDocs.filter(d => selectedIds.includes(d.id)),
    [allDocs, selectedIds],
  )

  const wrap = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try { await fn() }
    catch (err) { setError(toErrorMessage(err)) }
    finally { setBusy(null) }
  }

  const bulkVerify = () => wrap('verify', async () => {
    for (const id of selectedIds) {
      const next = await verifyDoc(id)
      applyDocUpdate(next)
    }
    onClear()
  })

  const bulkArchive = () => wrap('archive', async () => {
    if (!confirm(`Archive ${selectedIds.length} doc${selectedIds.length !== 1 ? 's' : ''}? They'll be hidden from the Library and marked archived in Notion.`)) return
    for (const id of selectedIds) {
      await archivePage(id, 'doc')
      applyDocArchived(id)
    }
    onClear()
  })

  const bulkSetGroup = (group: string) => wrap(`group:${group}`, async () => {
    for (const id of selectedIds) {
      const next = await updateDoc(id, { groups: [group] })
      applyDocUpdate(next)
    }
    onClear()
  })

  const bulkSetType = (type: string) => wrap(`type:${type}`, async () => {
    for (const id of selectedIds) {
      const next = await updateDoc(id, { types: [type] })
      applyDocUpdate(next)
    }
    onClear()
  })

  const bulkToggleRequired = (mark: boolean) => wrap(mark ? 'req+' : 'req-', async () => {
    if (!me.employeeId) throw new Error('Not signed in')
    for (const id of selectedIds) {
      if (mark) await setDocRequired(id, me.employeeId)
      else await unsetDocRequired(id)
    }
    // Required reading lives in a Supabase table; the LibraryDataContext
    // re-fetches on the next refresh. Optimistically nudge by mutating
    // the set is harder cross-context — caller can refresh if needed.
    onClear()
  })

  const bulkToggleOnboarding = (mark: boolean) => wrap(mark ? 'onb+' : 'onb-', async () => {
    for (const id of selectedIds) {
      const doc = allDocs.find(d => d.id === id)
      if (!doc) continue
      const wf = new Set(doc.workflowSteps)
      if (mark) wf.add('Internal: Team Onboarding')
      else wf.delete('Internal: Team Onboarding')
      const next = await updateDoc(id, {
        priorityDoc: mark,
        workflowSteps: [...wf],
      })
      applyDocUpdate(next)
    }
    onClear()
  })

  const allRequired = selectedDocs.every(d => requiredReading.has(d.id))
  const allOnboarding = selectedDocs.every(d =>
    d.priorityDoc && d.workflowSteps.includes('Internal: Team Onboarding'),
  )

  return (
    <div className="px-3 py-2 bg-[var(--color-lib-accent-soft)] border-b border-[var(--color-lib-accent)] flex items-center gap-2 flex-wrap text-xs">
      <span className="font-semibold text-[var(--color-lib-accent)]">
        {selectedIds.length} selected
      </span>
      <button type="button" onClick={onClear} className="text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-text)] underline text-[11px]">
        Clear
      </button>
      <span className="flex-1" />

      {bucket === 'needs-verification' && (
        <BulkButton onClick={bulkVerify} disabled={busy !== null} loading={busy === 'verify'}>
          <Check size={11} /> Verify
        </BulkButton>
      )}
      <BulkButton onClick={() => bulkToggleOnboarding(!allOnboarding)} disabled={busy !== null} loading={busy === 'onb+' || busy === 'onb-'}>
        <Star size={11} className={allOnboarding ? 'fill-current' : ''} />
        {allOnboarding ? 'Remove from Onboarding' : 'Mark Onboarding'}
      </BulkButton>
      <BulkButton onClick={() => bulkToggleRequired(!allRequired)} disabled={busy !== null} loading={busy === 'req+' || busy === 'req-'}>
        <Star size={11} className={allRequired ? 'fill-current' : ''} />
        {allRequired ? 'Unmark Required' : 'Mark Required'}
      </BulkButton>
      <BulkMenu label="Set Group" busy={busy?.startsWith('group:') ?? false}>
        {DOC_GROUPS.map(g => (
          <button key={g} type="button" onClick={() => bulkSetGroup(g)} className="block w-full text-left px-2 py-1 text-xs hover:bg-[var(--color-lib-bg)]">
            {g}
          </button>
        ))}
      </BulkMenu>
      <BulkMenu label="Set Type" busy={busy?.startsWith('type:') ?? false}>
        {DOC_TYPES.map(t => (
          <button key={t} type="button" onClick={() => bulkSetType(t)} className="block w-full text-left px-2 py-1 text-xs hover:bg-[var(--color-lib-bg)]">
            {t}
          </button>
        ))}
      </BulkMenu>
      <BulkButton onClick={bulkArchive} disabled={busy !== null} loading={busy === 'archive'} tone="danger">
        <Trash2 size={11} /> Archive
      </BulkButton>

      {error && <p className="basis-full text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}

function BulkButton({ children, onClick, disabled, loading, tone }: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-1 rounded-sm border bg-white px-2 py-1 text-[11px] font-medium disabled:opacity-50',
        tone === 'danger'
          ? 'border-[var(--color-lib-border)] text-[var(--color-lib-text-muted)] hover:border-red-400 hover:text-red-600'
          : 'border-[var(--color-lib-border)] text-[var(--color-lib-text)] hover:border-[var(--color-lib-border-strong)]',
      ].join(' ')}
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : children}
    </button>
  )
}

function BulkMenu({ label, children, busy }: { label: string; children: React.ReactNode; busy: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white px-2 py-1 text-[11px] font-medium text-[var(--color-lib-text)] hover:border-[var(--color-lib-border-strong)]"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Pencil size={11} />}
        {label}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-10 w-48 rounded-sm border border-[var(--color-lib-border)] bg-white shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          <div onClick={() => setOpen(false)}>{children}</div>
        </div>
      )}
    </div>
  )
}

// ── Milestone & Pathway editor ──────────────────────────────────────────

function MilestonePathwayEditor({ docs }: { docs: DocHubEntry[] }) {
  const [editMode, setEditMode] = useState(false)
  const [defs, setDefs] = useState<MilestoneDefinitionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [templateCounts, setTemplateCounts] = useState<Map<string, number>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ squad: string; pathway: string } | null>(null)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await listAllMilestoneDefinitions()
      setDefs(all)
      // Pull template counts via the correct FK column (`milestone_id`,
      // not `milestone_definition_id` — the table uses the shorter name).
      // Filter to active templates so archived templates don't inflate
      // the rollup.
      const { data: tpls, error: tplErr } = await supabase
        .from('strategy_message_templates')
        .select('milestone_id, is_active')
      if (tplErr) throw tplErr
      const m = new Map<string, number>()
      for (const t of (tpls ?? []) as Array<{ milestone_id: string | null; is_active: boolean | null }>) {
        if (!t.milestone_id) continue
        if (t.is_active === false) continue
        m.set(t.milestone_id, (m.get(t.milestone_id) ?? 0) + 1)
      }
      setTemplateCounts(m)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Tab is mounted on demand by the parent — load once on first render.
  useEffect(() => { void reload() }, [])
  /* eslint-disable react-hooks/exhaustive-deps */

  /** Always include inactive rows so directors can see the full
   *  catalog at a glance — they're rendered with a muted style + an
   *  "Inactive" badge so the difference is unmistakable. */
  const visibleGroups = useMemo<SquadGroup[]>(
    () => groupMilestones(defs),
    [defs],
  )

  // Doc count per step name — for the rollup column.
  const docCountsByStepName = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of docs) {
      for (const s of d.workflowSteps) m.set(s, (m.get(s) ?? 0) + 1)
    }
    return m
  }, [docs])

  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-white">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-lib-border)]">
        <Settings size={16} className="text-[var(--color-lib-accent)]" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-[var(--color-lib-text)]">
            Milestones & Pathways
          </p>
          <p className="text-[11px] text-[var(--color-lib-text-muted)]">
            View the milestone tree at a glance. Open <em>Edit pathways</em> to rename, reorder, or change visibility.
          </p>
        </div>
        <Link
          to="/templates"
          className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--color-lib-text)] hover:border-[var(--color-lib-border-strong)]"
        >
          Edit templates
          <ChevronRight size={10} />
        </Link>
      </div>

      <div className="px-4 pb-4 pt-3 space-y-3">
        {/* Edit mode toggle — the controls (rename input, reorder arrows,
            visibility / active toggles) only render in edit mode. Default
            view is read-only so the tree reads as a milestone reference,
            not a settings panel. */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-[var(--color-lib-text-muted)]">
            {editMode
              ? 'Editing — changes save as you go. Click Done when finished.'
              : `${defs.filter(d => d.is_active).length} active step${defs.filter(d => d.is_active).length === 1 ? '' : 's'} · ${defs.filter(d => !d.is_active).length} inactive`}
          </p>
          <button
            type="button"
            onClick={() => setEditMode(m => !m)}
            className={[
              'inline-flex items-center gap-1.5 rounded-md text-xs font-medium px-3 py-1.5',
              editMode
                ? 'bg-[var(--color-lib-accent)] text-white hover:bg-[var(--color-lib-accent-hover)]'
                : 'border border-[var(--color-lib-accent)] text-[var(--color-lib-accent)] bg-white hover:bg-[var(--color-lib-accent-soft)]',
            ].join(' ')}
          >
            {editMode ? <><Check size={12} /> Done editing</> : <><Pencil size={12} /> Edit pathways</>}
          </button>
        </div>

        {/* Heads-up callout — only shown while editing. Milestones are
            referenced by every milestone submission and surface on the
            partner portal, so we surface the consequences before edits
            happen. */}
        {editMode && (
          <div className="rounded-md border border-[#F59E0B]/40 bg-[#FEF3C7] px-3 py-2 text-[11px] text-[var(--color-priority-medium)] leading-relaxed">
            <strong>Heads up:</strong> these milestones power Submit Milestone, the Template Editor, the partner portal, and the Library workflow tags. <strong>Renames apply retroactively</strong> — every past submission references the milestone by ID, so a rename changes how it's labeled everywhere. Toggling <em>Visibility</em> between Internal and Partner-facing controls whether partners see the milestone on their portal. Toggling <em>Active</em> off hides it from new submissions; past submissions keep their data.
          </div>
        )}

        {loading && <p className="text-xs text-[var(--color-lib-text-subtle)] italic">Loading milestones…</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}

        {visibleGroups.map(squad => (
          <details key={squad.squad} open className="rounded-md border border-[var(--color-lib-border)]">
            <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden bg-[var(--color-lib-bg)]">
              <ChevronDown size={11} className="text-[var(--color-lib-text-subtle)]" />
              <span className="text-sm font-semibold text-[var(--color-lib-text)]">{squad.squadLabel}</span>
              <span className="text-[10px] text-[var(--color-lib-text-subtle)] ml-auto">
                {squad.pathways.length} pathway{squad.pathways.length !== 1 ? 's' : ''}
              </span>
            </summary>
            <div className="px-3 py-2">
              {squad.pathways.map(p => (
                <div key={p.pathway} className="mb-3 last:mb-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-muted)]">
                      {p.pathwayLabel}
                    </span>
                    <span className="text-[10px] text-[var(--color-lib-text-subtle)]">
                      ({p.steps.length} step{p.steps.length !== 1 ? 's' : ''})
                    </span>
                    {editMode && (
                      <button
                        type="button"
                        onClick={() => setAdding({ squad: squad.squad, pathway: p.pathway })}
                        className="ml-auto text-[10px] font-semibold text-[var(--color-lib-accent)] hover:underline"
                      >
                        + Add step
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {p.steps.map(s => {
                      // Find the live row to detect is_active state (the
                      // SquadGroup objects are normalized; look up by id).
                      const row = defs.find(d => d.id === s.id)
                      return (
                        <StepRow
                          key={s.id}
                          step={s}
                          isActive={row?.is_active ?? true}
                          isPartnerFacing={row?.is_partner_facing ?? false}
                          docCount={docCountsByStepName.get(s.step_name) ?? 0}
                          templateCount={templateCounts.get(s.id) ?? 0}
                          editMode={editMode}
                          onChange={reload}
                          siblings={p.steps}
                        />
                      )
                    })}
                  </div>
                  {editMode && adding?.squad === squad.squad && adding?.pathway === p.pathway && (
                    <NewStepRow
                      squad={squad.squad}
                      pathway={p.pathway}
                      nextNumber={p.steps.length > 0 ? Math.max(...p.steps.map(s => s.step_number)) + 1 : 1}
                      onCancel={() => setAdding(null)}
                      onCreated={async () => { setAdding(null); await reload() }}
                    />
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

/** Defensive error-to-string conversion. Supabase errors are plain
 *  objects with `message` and `code` fields — `String(err)` on those
 *  produces "[object Object]" instead of the actual message. This helper
 *  unwraps in priority order: Error → Error.message; object with
 *  message → that message; everything else → String(). */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const maybe = err as { message?: unknown }
    if (typeof maybe.message === 'string') return maybe.message
    try { return JSON.stringify(err) } catch { /* fall through */ }
  }
  return String(err)
}

function StepRow({
  step, isActive, isPartnerFacing, docCount, templateCount, editMode, onChange, siblings,
}: {
  step: { id: string; step_number: number; step_name: string }
  isActive: boolean
  isPartnerFacing: boolean
  docCount: number
  templateCount: number
  /** When false, the row renders as a read-only summary with the step
   *  name + counters + status pills. When true, controls (rename input,
   *  reorder arrows, visibility / active segmented controls) appear. */
  editMode: boolean
  onChange: () => Promise<void>
  siblings: Array<{ id: string; step_number: number }>
}) {
  // Draft + Save model: name edits live locally until the user clicks
  // Save. Visibility + Active changes go through confirmation modals
  // because both surface to the partner portal / submissions.
  const [name, setName] = useState(step.step_name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingState, setConfirmingState] = useState<'visibility' | 'active' | null>(null)
  const dirtyName = name.trim() !== step.step_name && name.trim().length > 0

  useEffect(() => { setName(step.step_name) }, [step.step_name])

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() }
    catch (err) { setError(toErrorMessage(err)) }
    finally { setBusy(false) }
  }

  const saveName = () => wrap(async () => {
    if (!dirtyName) return
    await updateMilestoneDefinition(step.id, { step_name: name.trim() })
    await onChange()
  })

  const move = (dir: -1 | 1) => wrap(async () => {
    const sorted = [...siblings].sort((a, b) => a.step_number - b.step_number)
    const idx = sorted.findIndex(s => s.id === step.id)
    if (idx < 0) return
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[swapIdx]
    await reorderMilestoneDefinitions([
      { id: a.id, step_number: b.step_number },
      { id: b.id, step_number: a.step_number },
    ])
    await onChange()
  })

  const handleConfirmVisibility = () => wrap(async () => {
    await updateMilestoneDefinition(step.id, { is_partner_facing: !isPartnerFacing })
    await onChange()
    setConfirmingState(null)
  })

  const handleConfirmActive = () => wrap(async () => {
    if (isActive) await archiveMilestoneDefinition(step.id)
    else await updateMilestoneDefinition(step.id, { is_active: true })
    await onChange()
    setConfirmingState(null)
  })

  return (
    <>
      <div
        className={[
          'flex items-center gap-3 px-3 py-2.5 rounded-md border bg-white text-xs',
          isActive
            ? 'border-[var(--color-lib-border)]'
            : 'border-dashed border-[var(--color-lib-border)] bg-[var(--color-lib-bg)]',
        ].join(' ')}
      >
        {editMode && (
          <span className="cursor-grab text-[var(--color-lib-text-subtle)] shrink-0" title="Reorder">
            <GripVertical size={12} />
          </span>
        )}
        <span className="text-[11px] text-[var(--color-lib-text-subtle)] tabular-nums text-right w-7 shrink-0">
          {step.step_number}.
        </span>

        {/* Step name — editable input in edit mode, plain text in
            view mode. The Save button only appears when the input is
            dirty so it's never visible noise. */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {editMode ? (
            <>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveName()
                  if (e.key === 'Escape') setName(step.step_name)
                }}
                disabled={busy}
                placeholder="Step name"
                className={[
                  'flex-1 min-w-0 rounded-sm border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-lib-accent)]',
                  dirtyName ? 'border-[var(--color-lib-accent)]' : 'border-[var(--color-lib-border)]',
                  isActive ? '' : 'line-through text-[var(--color-lib-text-muted)]',
                ].join(' ')}
              />
              {dirtyName && (
                <button
                  type="button"
                  onClick={saveName}
                  disabled={busy}
                  className="inline-flex items-center gap-0.5 rounded-sm bg-[var(--color-lib-accent)] text-white text-[11px] font-semibold px-2.5 py-1.5 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
                >
                  {busy ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
                </button>
              )}
            </>
          ) : (
            <span
              className={[
                'flex-1 min-w-0 truncate text-sm',
                isActive ? 'text-[var(--color-lib-text)]' : 'line-through text-[var(--color-lib-text-muted)]',
              ].join(' ')}
            >
              {step.step_name}
            </span>
          )}
        </div>

        <span
          className={[
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium tabular-nums whitespace-nowrap',
            docCount > 0 ? 'bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)]' : 'bg-[var(--color-lib-bg)] text-[var(--color-lib-text-subtle)]',
          ].join(' ')}
          title={`${docCount} doc(s) tagged with this step`}
        >
          {docCount} doc{docCount === 1 ? '' : 's'}
        </span>
        <span
          className={[
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium tabular-nums whitespace-nowrap',
            templateCount > 0 ? 'bg-[#FEF3C7] text-[var(--color-priority-medium)]' : 'bg-[var(--color-lib-bg)] text-[var(--color-lib-text-subtle)]',
          ].join(' ')}
          title={`${templateCount} message template(s) tied to this step`}
        >
          {templateCount} template{templateCount === 1 ? '' : 's'}
        </span>

        {editMode ? (
          <>
            {/* Reorder */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button type="button" onClick={() => move(-1)} disabled={busy} title="Move up" className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)] disabled:opacity-50 px-1.5 text-base leading-none">↑</button>
              <button type="button" onClick={() => move(1)} disabled={busy} title="Move down" className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)] disabled:opacity-50 px-1.5 text-base leading-none">↓</button>
            </div>

            {/* Visibility — clearly labeled segmented control. Both
                options are visible so the user knows it's editable;
                clicking the unselected option opens a confirm modal
                because flipping this changes what partners see on
                their portal. */}
            <SegmentedToggle
              ariaLabel="Visibility"
              value={isPartnerFacing ? 'partner' : 'internal'}
              options={[
                { value: 'internal', label: 'Internal', tone: 'neutral' as const },
                { value: 'partner',  label: 'Partner',  tone: 'partner' as const },
              ]}
              disabled={busy}
              onChange={() => setConfirmingState('visibility')}
            />

            {/* Active state — same segmented-control pattern. */}
            <SegmentedToggle
              ariaLabel="Status"
              value={isActive ? 'active' : 'inactive'}
              options={[
                { value: 'active',   label: 'Active',   tone: 'active' as const },
                { value: 'inactive', label: 'Inactive', tone: 'neutral' as const },
              ]}
              disabled={busy}
              onChange={() => setConfirmingState('active')}
            />
          </>
        ) : (
          // View-mode status pills — read-only summary of partner-facing
          // and active state.
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={[
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest',
                isPartnerFacing ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'bg-[var(--color-lib-bg)] text-[var(--color-lib-text-subtle)]',
              ].join(' ')}
            >
              {isPartnerFacing ? 'Partner' : 'Internal'}
            </span>
            <span
              className={[
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest',
                isActive ? 'bg-[var(--color-verif-verified-bg)] text-[var(--color-verif-verified-fg)]' : 'bg-[var(--color-lib-bg)] text-[var(--color-lib-text-subtle)]',
              ].join(' ')}
            >
              {isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        )}
      </div>
      {error && <p className="text-[10px] text-red-600 mt-1 ml-3">{error}</p>}

      {confirmingState === 'visibility' && (
        <ConfirmModal
          title={isPartnerFacing
            ? `Hide "${step.step_name}" from partner portals?`
            : `Make "${step.step_name}" visible on partner portals?`}
          body={isPartnerFacing
            ? <>Switching to <strong>Internal</strong> means partners will no longer see this milestone on their portal. Past submissions stay visible to staff but disappear from the partner-facing timeline. Templates that reference this step keep their tag.</>
            : <>Switching to <strong>Partner-facing</strong> means every existing submission tagged with this step (including past ones) will appear on the partner's portal. Make sure those messages are appropriate to share with partners.</>
          }
          confirmLabel={isPartnerFacing ? 'Yes, set to Internal' : 'Yes, make Partner-facing'}
          confirmTone="warning"
          busy={busy}
          onCancel={() => setConfirmingState(null)}
          onConfirm={handleConfirmVisibility}
        />
      )}
      {confirmingState === 'active' && (
        <ConfirmModal
          title={isActive
            ? `Mark "${step.step_name}" as Inactive?`
            : `Reactivate "${step.step_name}"?`}
          body={isActive
            ? <>Inactive milestones disappear from the Submit Milestone workflow, the Library Workflow Step menu, and the Template Editor's tree. <strong>Existing submissions still reference this milestone by ID</strong>, so they continue to render with this name on partner portals and account logs — going Inactive only affects new submissions. {docCount > 0 && <>Currently <strong>{docCount} library doc{docCount === 1 ? '' : 's'}</strong> {docCount === 1 ? 'is' : 'are'} tagged with this step.</>}{templateCount > 0 && <> <strong>{templateCount} template{templateCount === 1 ? '' : 's'}</strong> reference{templateCount === 1 ? 's' : ''} it.</>}</>
            : <>Reactivating brings the step back into the workflow. No data is changed beyond the active flag.</>
          }
          confirmLabel={isActive ? 'Mark Inactive' : 'Reactivate'}
          confirmTone={isActive ? 'warning' : 'primary'}
          busy={busy}
          onCancel={() => setConfirmingState(null)}
          onConfirm={handleConfirmActive}
        />
      )}
    </>
  )
}

/** Two-option segmented control. Both options are visible at all times
 *  so the user can see they have a choice; clicking the inactive option
 *  fires `onChange()`. Used for the Internal/Partner-facing and Active/
 *  Inactive toggles in the milestone editor. */
function SegmentedToggle({
  ariaLabel, value, options, disabled, onChange,
}: {
  ariaLabel: string
  value: string
  options: Array<{ value: string; label: string; tone: 'active' | 'partner' | 'neutral' }>
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-md border border-[var(--color-lib-border)] bg-white overflow-hidden"
    >
      {options.map(opt => {
        const selected = opt.value === value
        const baseClass = 'inline-flex items-center justify-center px-2 py-1 text-[10px] font-semibold uppercase tracking-widest min-w-[60px] disabled:opacity-50'
        const selectedClass =
          opt.tone === 'active' ? 'bg-[var(--color-status-launched)] text-white'
          : opt.tone === 'partner' ? 'bg-[#1D4ED8] text-white'
          : 'bg-[var(--color-lib-text-muted)] text-white'
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => { if (!selected) onChange() }}
            disabled={disabled}
            className={[
              baseClass,
              selected ? selectedClass : 'text-[var(--color-lib-text-muted)] hover:text-[var(--color-lib-text)] hover:bg-[var(--color-lib-bg)]',
            ].join(' ')}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** Generic confirmation modal — used by the milestone editor for
 *  high-impact toggles. Body is a ReactNode so callers can mix in
 *  bold + counts inline with prose. */
function ConfirmModal({
  title, body, confirmLabel, confirmTone, busy, onCancel, onConfirm,
}: {
  title: string
  body: React.ReactNode
  confirmLabel: string
  confirmTone: 'primary' | 'warning' | 'danger'
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onCancel}>
      <div
        className="bg-white rounded-lg max-w-md w-full p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-[var(--color-lib-text)] mb-2">{title}</h3>
        <div className="text-sm text-[var(--color-lib-text-muted)] leading-relaxed mb-4">
          {body}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white text-sm px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={[
              'inline-flex items-center gap-1 rounded-sm text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50',
              confirmTone === 'primary' ? 'bg-[var(--color-lib-accent)] hover:bg-[var(--color-lib-accent-hover)]'
              : confirmTone === 'warning' ? 'bg-[var(--color-priority-medium)] hover:opacity-90'
              : 'bg-red-600 hover:bg-red-700',
            ].join(' ')}
          >
            {busy && <Loader2 size={11} className="animate-spin" />}
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function NewStepRow({ squad, pathway, nextNumber, onCancel, onCreated }: {
  squad: string
  pathway: string
  nextNumber: number
  onCancel: () => void
  onCreated: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [number, setNumber] = useState(nextNumber)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!name.trim()) { setError('Name required'); return }
    setBusy(true); setError(null)
    try {
      await addMilestoneDefinition({
        squad, pathway,
        step_number: number,
        step_name: name.trim(),
      })
      await onCreated()
    } catch (err) { setError(toErrorMessage(err)) }
    finally { setBusy(false) }
  }

  return (
    <div className="grid grid-cols-[20px_60px_1fr_auto] gap-2 items-center px-2 py-1.5 mt-1 rounded-sm border border-dashed border-[var(--color-lib-accent)] bg-[var(--color-lib-accent-soft)] text-xs">
      <Plus size={11} className="text-[var(--color-lib-accent)]" />
      <input
        type="number"
        value={number}
        onChange={e => setNumber(parseInt(e.target.value, 10) || 0)}
        disabled={busy}
        className="w-full rounded-sm border border-[var(--color-lib-border)] bg-white px-1.5 py-0.5 outline-none"
      />
      <input
        autoFocus
        placeholder="Step name…"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') onCancel()
        }}
        disabled={busy}
        className="w-full rounded-sm border border-[var(--color-lib-border)] bg-white px-1.5 py-0.5 outline-none"
      />
      <div className="flex items-center gap-1">
        <button type="button" onClick={save} disabled={busy} className="rounded-sm bg-[var(--color-lib-accent)] text-white text-[10px] px-2 py-0.5 disabled:opacity-50">
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-sm border border-[var(--color-lib-border)] bg-white text-[10px] px-2 py-0.5">
          Cancel
        </button>
      </div>
      {error && <span className="col-span-4 text-[10px] text-red-600">{error}</span>}
    </div>
  )
}
